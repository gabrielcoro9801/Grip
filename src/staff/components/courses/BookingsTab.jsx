import React, { useState, useMemo } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import StatusBadge from "@/ui/StatusBadge";
import { EmptyState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { ArrowDown, ArrowUp, Check, Clock, ClipboardCheck, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatData } from "@/core/domain/format";
import { lezioneFinita } from "@/core/domain/giorni";

// L'ordine delle righe dentro una lezione: chi entra, chi aspetta (nel suo ordine), chi ha disdetto.
const ORDINE_STATO = { confirmed: 0, waitlisted: 1, cancelled: 2 };
const hhmm = (t) => String(t ?? "").slice(0, 5);

/**
 * Le prenotazioni, come le lavora la reception.
 *
 * Erano un elenco da cui si poteva solo disdire. Ora sono raggruppate per lezione — è lì che
 * si decide chi entra — e da qui si prenota per un socio, si conferma chi è in lista d'attesa,
 * lo si rimette in lista, si riattiva una disdetta, si cambia l'ordine della lista e si
 * cancella una prenotazione inserita per errore.
 *
 * Ogni decisione la prende il server, con la lezione bloccata: la pagina propone, e se nel
 * frattempo i posti sono cambiati la risposta lo dice. Il portale legge le stesse righe, quindi
 * il socio vede subito quello che la reception ha fatto.
 */
export default function BookingsTab({ data, reload }) {
  const { bookings, sessions, events, courses, rooms, members } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [cerca, setCerca] = useState("");
  const [stato, setStato] = useState("vive");
  const [periodo, setPeriodo] = useState("prossime");
  const [inCorso, setInCorso] = useState(false);
  const [nuova, setNuova] = useState(null); // { session_id, member_id, cercaSocio }

  // Per ogni lezione: corso, sala, e se è già finita.
  const lezioni = useMemo(() => {
    const perId = new Map();
    for (const s of sessions) {
      const evento = events.find((e) => e.id === s.event_id);
      perId.set(s.id, {
        ...s,
        corso: courses.find((c) => c.id === evento?.course_id) ?? null,
        sala: rooms.find((r) => r.id === s.room_id) ?? null,
        finita: lezioneFinita(s),
      });
    }
    return perId;
  }, [sessions, events, courses, rooms]);

  const confermatiDi = (sessionId) => bookings.filter((b) => b.session_id === sessionId && b.status === "confirmed").length;

  const gruppi = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const perLezione = new Map();
    for (const b of bookings) {
      const lezione = lezioni.get(b.session_id);
      if (!lezione) continue;
      if (periodo === "prossime" && lezione.finita) continue;
      if (periodo === "passate" && !lezione.finita) continue;
      if (stato === "vive" && b.status === "cancelled") continue;
      if (!["vive", "tutte"].includes(stato) && b.status !== stato) continue;
      if (q && !`${b.member_name ?? ""} ${lezione.corso?.name ?? ""}`.toLowerCase().includes(q)) continue;
      if (!perLezione.has(lezione.id)) perLezione.set(lezione.id, { lezione, righe: [] });
      perLezione.get(lezione.id).righe.push(b);
    }
    const elenco = [...perLezione.values()];
    for (const g of elenco) {
      g.righe.sort((a, b) => (ORDINE_STATO[a.status] ?? 9) - (ORDINE_STATO[b.status] ?? 9)
        || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0)
        || String(a.member_name ?? "").localeCompare(String(b.member_name ?? ""), "it"));
    }
    // Le prossime dalla più vicina, le passate dalla più recente.
    const verso = periodo === "passate" ? -1 : 1;
    return elenco.sort((a, b) => verso * (`${a.lezione.date} ${a.lezione.start_time}`).localeCompare(`${b.lezione.date} ${b.lezione.start_time}`));
  }, [bookings, lezioni, cerca, stato, periodo]);

  /** Esegue un'azione, dice com'è andata, e ricarica. Chi è salito dalla lista si nomina. */
  const esegui = async (azione, riuscita) => {
    setInCorso(true);
    try {
      const esito = await azione();
      const promossi = esito?.promossi ?? [];
      toast({
        title: riuscita,
        description: promossi.length ? `Dalla lista d'attesa: ${promossi.map((p) => p.member_name).join(", ")}.` : undefined,
      });
      reload();
      return true;
    } catch (err) {
      toast({ title: "Operazione non riuscita", description: err.message, variant: "destructive" });
      return false;
    } finally {
      setInCorso(false);
    }
  };

  /** Confermare: se la lezione è piena il server rifiuta, e si chiede se andare oltre la capienza. */
  const confermaPrenotazione = async (b) => {
    setInCorso(true);
    try {
      await api.prenotazioni.cambiaStato(b.id, "confirmed");
      toast({ title: `${b.member_name}: confermata` });
      reload();
    } catch (err) {
      setInCorso(false);
      if (err.code !== "lezione_piena") {
        toast({ title: "Operazione non riuscita", description: err.message, variant: "destructive" });
        return;
      }
      const ok = await conferma({
        title: "Lezione al completo",
        description: `${err.message} Confermare comunque ${b.member_name}?`,
        confirmLabel: "Conferma oltre la capienza",
        cancelLabel: "Lascia com'è",
      });
      if (ok) await esegui(() => api.prenotazioni.cambiaStato(b.id, "confirmed", { oltreCapienza: true }), `${b.member_name}: confermata oltre la capienza`);
      return;
    }
    setInCorso(false);
  };

  const inLista = (b) => esegui(() => api.prenotazioni.cambiaStato(b.id, "waitlisted"), `${b.member_name}: in lista d'attesa`);

  const annulla = async (b) => {
    const ok = await conferma({
      title: `Annullare la prenotazione di ${b.member_name}?`,
      description: b.status === "confirmed" ? "Il posto si libera, e il primo in lista d'attesa viene confermato." : undefined,
      confirmLabel: "Annulla prenotazione",
      cancelLabel: "Lascia com'è",
      destructive: true,
    });
    if (ok) await esegui(() => api.prenotazioni.cambiaStato(b.id, "cancelled"), `${b.member_name}: prenotazione annullata`);
  };

  // Una disdetta torna confermata se c'è posto, altrimenti in coda alla lista.
  const riattiva = (b, lezione) => {
    const libero = confermatiDi(lezione.id) < (lezione.capacity ?? 0);
    return esegui(
      () => api.prenotazioni.cambiaStato(b.id, libero ? "confirmed" : "waitlisted"),
      libero ? `${b.member_name}: riattivata e confermata` : `${b.member_name}: riattivata in lista d'attesa`,
    );
  };

  const sposta = (b, posizione) => esegui(() => api.prenotazioni.spostaInLista(b.id, posizione), `${b.member_name}: posizione ${posizione}`);

  const elimina = async (b) => {
    const ok = await conferma({
      title: `Eliminare la prenotazione di ${b.member_name}?`,
      description: "Sparisce anche dallo storico, come se non fosse mai stata fatta: serve per quelle inserite per errore. Per una disdetta usa «Annulla».",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (ok) await esegui(() => api.prenotazioni.elimina(b.id), "Prenotazione eliminata");
  };

  // --- Nuova prenotazione ------------------------------------------------------------------

  const lezioniPrenotabili = useMemo(
    () => [...lezioni.values()]
      .filter((l) => !l.finita && l.status !== "cancelled")
      .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`)),
    [lezioni],
  );

  const sociPrenotabili = useMemo(() => {
    const q = (nuova?.cercaSocio ?? "").trim().toLowerCase();
    return members
      .filter((m) => !m.archiviato_il)
      .filter((m) => !q || `${m.full_name ?? ""} ${m.codice_socio ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.cognome ?? "").localeCompare(String(b.cognome ?? ""), "it") || String(a.nome ?? "").localeCompare(String(b.nome ?? ""), "it"))
      .slice(0, 50);
  }, [members, nuova?.cercaSocio]);

  const etichettaLezione = (l) =>
    `${formatData(l.date, "giorno")} · ${hhmm(l.start_time)} · ${l.corso?.name ?? "Corso"} (${confermatiDi(l.id)}/${l.capacity ?? 0})`;

  const creaPrenotazione = async (e) => {
    e.preventDefault();
    if (!nuova?.session_id || !nuova?.member_id) return;
    setInCorso(true);
    try {
      const { booking } = await api.prenotazioni.crea({ sessionId: nuova.session_id, memberId: nuova.member_id });
      toast({
        title: booking.status === "confirmed" ? "Prenotazione confermata" : "Aggiunto alla lista d'attesa",
        description: booking.status === "confirmed" ? booking.member_name : `${booking.member_name} — posizione ${booking.waitlist_position}`,
      });
      setNuova(null);
      reload();
    } catch (err) {
      toast({ title: "Prenotazione non creata", description: err.message, variant: "destructive" });
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="space-y-4">
      {dialogoConferma}
      <div className="flex flex-wrap items-end gap-3">
        {puoModificare && (
          <Button size="sm" onClick={() => setNuova({ session_id: "", member_id: "", cercaSocio: "" })}>
            <Plus className="w-4 h-4 mr-1" /> Nuova prenotazione
          </Button>
        )}
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input placeholder="Socio o corso…" aria-label="Cerca" value={cerca} onChange={(e) => setCerca(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[150px]" aria-label="Quali lezioni"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prossime">Prossime lezioni</SelectItem>
              <SelectItem value="passate">Lezioni passate</SelectItem>
              <SelectItem value="tutte">Tutte le lezioni</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stato} onValueChange={setStato}>
            <SelectTrigger className="w-[170px]" aria-label="Quali prenotazioni"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vive">Confermate e in lista</SelectItem>
              <SelectItem value="confirmed">Solo confermate</SelectItem>
              <SelectItem value="waitlisted">Solo in lista d'attesa</SelectItem>
              <SelectItem value="cancelled">Solo annullate</SelectItem>
              <SelectItem value="tutte">Tutte</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {gruppi.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nessuna prenotazione"
          description={cerca || stato !== "vive" || periodo !== "prossime"
            ? "Nessuna prenotazione corrisponde ai filtri scelti."
            : "Le prenotazioni delle prossime lezioni compaiono qui, che le faccia il socio dal portale o la reception da qui."}
        />
      ) : (
        <div className="space-y-4">
          {gruppi.map(({ lezione, righe }) => {
            const confermati = confermatiDi(lezione.id);
            const inAttesa = bookings.filter((b) => b.session_id === lezione.id && b.status === "waitlisted").length;
            const modificabile = puoModificare && !lezione.finita;
            return (
              <Card key={lezione.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-heading font-semibold truncate">{lezione.corso?.name ?? "Corso"}</h3>
                      <p className="text-xs text-muted-foreground">
                        {formatData(lezione.date, "estesaBreve")} · {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}
                        {lezione.sala ? ` · ${lezione.sala.name}` : ""}
                        {lezione.finita ? " · finita" : ""}
                        {lezione.status === "cancelled" ? " · lezione annullata" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`tabular-nums ${confermati > (lezione.capacity ?? 0) ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {confermati}/{lezione.capacity ?? 0} posti{inAttesa ? ` · ${inAttesa} in lista` : ""}
                      </span>
                      {modificabile && lezione.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => setNuova({ session_id: lezione.id, member_id: "", cercaSocio: "" })}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Aggiungi
                        </Button>
                      )}
                    </div>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {righe.map((b) => (
                      <li key={b.id} className="py-2 flex flex-wrap items-center gap-2">
                        <span className="flex-1 min-w-[10rem] text-sm font-medium truncate">{b.member_name}</span>
                        <StatusBadge
                          status={b.status}
                          label={b.status === "waitlisted" ? `In lista · ${b.waitlist_position ?? "?"}°` : b.status === "cancelled" ? "Annullata" : "Confermata"}
                        />
                        {modificabile && (
                          <div className="flex items-center gap-0.5">
                            {b.status === "waitlisted" && (
                              <>
                                <Button
                                  variant="ghost" size="icon" className="h-8 w-8" title="Sposta su" aria-label={`Sposta su ${b.member_name}`}
                                  disabled={inCorso || (b.waitlist_position ?? 1) <= 1} onClick={() => sposta(b, (b.waitlist_position ?? 1) - 1)}
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-8 w-8" title="Sposta giù" aria-label={`Sposta giù ${b.member_name}`}
                                  disabled={inCorso || (b.waitlist_position ?? 1) >= inAttesa} onClick={() => sposta(b, (b.waitlist_position ?? 1) + 1)}
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-success" title="Conferma" aria-label={`Conferma ${b.member_name}`} disabled={inCorso} onClick={() => confermaPrenotazione(b)}>
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            {b.status === "confirmed" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Metti in lista d'attesa" aria-label={`Metti in lista d'attesa ${b.member_name}`} disabled={inCorso} onClick={() => inLista(b)}>
                                <Clock className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {b.status === "cancelled" ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Riattiva" aria-label={`Riattiva ${b.member_name}`} disabled={inCorso || lezione.status === "cancelled"} onClick={() => riattiva(b, lezione)}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Annulla prenotazione" aria-label={`Annulla ${b.member_name}`} disabled={inCorso} onClick={() => annulla(b)}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Elimina (inserita per errore)" aria-label={`Elimina ${b.member_name}`} disabled={inCorso} onClick={() => elimina(b)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!nuova} onOpenChange={(aperta) => !aperta && setNuova(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuova prenotazione</DialogTitle></DialogHeader>
          {nuova && (
            <form onSubmit={creaPrenotazione} className="space-y-3">
              <div>
                <Label>Lezione *</Label>
                <Select value={nuova.session_id} onValueChange={(v) => setNuova({ ...nuova, session_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Scegli la lezione" /></SelectTrigger>
                  <SelectContent>
                    {lezioniPrenotabili.map((l) => <SelectItem key={l.id} value={l.id}>{etichettaLezione(l)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {lezioniPrenotabili.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessuna lezione in programma.</p>}
              </div>
              <div>
                <Label htmlFor="nuova-cerca-socio">Socio *</Label>
                <Input
                  id="nuova-cerca-socio" placeholder="Cerca per nome o codice…" className="mb-2"
                  value={nuova.cercaSocio} onChange={(e) => setNuova({ ...nuova, cercaSocio: e.target.value })}
                />
                <Select value={nuova.member_id} onValueChange={(v) => setNuova({ ...nuova, member_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Scegli il socio" /></SelectTrigger>
                  <SelectContent>
                    {sociPrenotabili.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name} · {m.codice_socio}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Se la lezione è al completo il socio va in lista d'attesa. Servono un abbonamento valido quel giorno e un socio non archiviato.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={!nuova.session_id || !nuova.member_id || inCorso}>
                {inCorso ? "Prenotazione…" : "Prenota"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
