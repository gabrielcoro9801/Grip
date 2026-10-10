import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import TrasformaInSocio from "@/staff/components/lead/TrasformaInSocio";
import AzioneLead from "@/staff/components/lead/AzioneLead";
import DiarioLead from "@/staff/components/lead/DiarioLead";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { formatData, toIsoDate } from "@/core/domain/format";
import { SESSI } from "@/core/domain/anagrafica";
import { oggiIso } from "@/core/domain/giorni";
import {
  NOTE_LEAD_MASSIMO, FILTRI_LEAD, SOGLIE_LEAD, condizioniLead, statoLead, statoAperto, descriviTempoLead, motivoLeadIncompleto,
} from "@/core/domain/lead";
import { Plus, Search, Contact, Pencil, Trash2, UserCheck, StickyNote, Phone, CalendarClock, XCircle, RotateCcw } from "lucide-react";

const nuovoLead = () => ({
  nome: "",
  cognome: "",
  telefono: "",
  email: "",
  data_contatto: toIsoDate(new Date()),
  canale_id: "",
  sesso: "",
  anno_nascita: "",
  note: "",
});

const ANNO_CORRENTE = new Date().getFullYear();

const TIPO_DOPPIONE = {
  socio: "socio",
  ex_socio: "ex socio",
  contatto_aperto: "contatto già aperto",
  contatto: "contatto chiuso",
};

export default function Contatti() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_leads");
  // Trasformare crea un socio: serve anche il permesso sui soci, come chiede il server.
  const puoTrasformare = puoModificare && canEdit(staffUser?.ruolo, "crm_members");

  const [leads, setLeads] = useState([]);
  const [canali, setCanali] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);
  const [cerca, setCerca] = useState("");
  const [modulo, setModulo] = useState(null); // { id?, ...campi }
  const [salvando, setSalvando] = useState(false);
  const [daTrasformare, setDaTrasformare] = useState(null);
  const [azione, setAzione] = useState(null); // { lead, tipo }
  const [inDiario, setInDiario] = useState(null);
  const [conteggi, setConteggi] = useState({});
  // Le soglie della palestra con cui il server ha contato i filtri: la pagina filtra con le stesse.
  const [soglie, setSoglie] = useState(SOGLIE_LEAD);
  // Le persone già note con il telefono o l'email che si sta scrivendo (GET /api/lead/doppioni).
  const [doppioni, setDoppioni] = useState([]);
  // Il filtro rapido sta nell'indirizzo: "Richiami di oggi" si può tenere nei preferiti.
  const [parametri, setParametri] = useSearchParams();
  const vista = FILTRI_LEAD.some((f) => f.valore === parametri.get("vista")) ? parametri.get("vista") : "aperti";
  const scegliVista = (v) => setParametri(v === "aperti" ? {} : { vista: v }, { replace: true });
  // Da Oggi e da Ctrl+K si arriva qui con il nome già cercato (`?q=`).
  useEffect(() => { if (parametri.get("q")) setCerca(parametri.get("q")); }, [parametri]);

  // `lavoro` porta i lead e i conteggi dei filtri.
  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([api.lead.lavoro(), api.entities.CanaleContatto.list("nome")])
      .then(([l, c]) => { setLeads(l.leads); setConteggi(l.conteggi); setSoglie(l.soglie ?? SOGLIE_LEAD); setCanali(c); })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const nomeCanale = useMemo(() => new Map(canali.map((c) => [c.id, c.nome])), [canali]);

  const oggi = oggiIso();
  const visibili = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    const nellaVista = leads.filter((l) => condizioniLead(l, oggi, soglie).has(vista));
    // I richiami si leggono in ordine di data: il più urgente in cima.
    if (vista === "richiami_oggi") nellaVista.sort((a, b) => String(a.richiamare_il).localeCompare(String(b.richiamare_il)));
    if (!t) return nellaVista;
    // Il telefono è salvato come +39…: si confrontano solo le cifre, comunque lo si scriva.
    const cifre = t.replace(/\D/g, "").replace(/^(00)?39(?=[03])/, "");
    return nellaVista.filter((l) =>
      `${l.nome} ${l.cognome ?? ""}`.toLowerCase().includes(t)
      || `${l.cognome ?? ""} ${l.nome}`.toLowerCase().includes(t)
      || (cifre.length >= 3 && (l.telefono ?? "").replace(/\D/g, "").includes(cifre))
      || (l.email ?? "").toLowerCase().includes(t)
      || (l.note ?? "").toLowerCase().includes(t)
    );
  }, [leads, cerca, vista, oggi, soglie]);

  // Nel modulo si propongono solo i canali attivi, più quello del lead che si sta modificando
  // se nel frattempo è stato disattivato: altrimenti il campo resterebbe vuoto.
  const canaliSceglibili = canali.filter((c) => c.attivo || c.id === modulo?.canale_id);

  // Di chi è (o è stato) socio, o di una persona già nota che si sta collegando, il modulo
  // tocca solo la trattativa: i dati della persona stanno sulla sua scheda.
  const soloTrattativa = Boolean(modulo?.socio_id || modulo?.persona_collegata);

  const apriModulo = (valori) => { setDoppioni([]); setModulo(valori); };

  // Mentre si scrive un recapito: è già di qualcuno? Si chiede uscendo dal campo, non a ogni tasto.
  const cercaDoppioni = async () => {
    if (!modulo || soloTrattativa) return;
    const { telefono, email, persona_id } = modulo;
    if (!telefono.trim() && !email.trim()) { setDoppioni([]); return; }
    try {
      setDoppioni((await api.lead.doppioni({ telefono, email, escludi: persona_id })).doppioni);
    } catch {
      setDoppioni([]); // un avviso che non arriva non deve bloccare la registrazione
    }
  };

  const collega = (d) => {
    setModulo({ ...nuovoLead(), data_contatto: modulo.data_contatto, canale_id: modulo.canale_id, persona_id: d.persona_id, persona_collegata: d });
    setDoppioni([]);
  };

  const salva = async (e) => {
    e.preventDefault();
    const { id } = modulo;
    // Solo i campi del modulo: il lead letto dall'API si porta dietro anche le date di sistema.
    const campi = Object.fromEntries(Object.keys(nuovoLead()).map((k) => [k, modulo[k]]));
    const dati = soloTrattativa
      ? { data_contatto: campi.data_contatto, canale_id: campi.canale_id, ...(id ? {} : { persona_id: modulo.persona_id }) }
      : { ...campi, anno_nascita: campi.anno_nascita === "" ? null : Number(campi.anno_nascita) };
    setSalvando(true);
    try {
      if (id) {
        await api.lead.aggiorna(id, dati);
      } else {
        await api.lead.crea(dati);
      }
      toast({ title: id ? "Contatto aggiornato" : "Contatto registrato" });
      setModulo(null);
      carica();
    } catch (err) {
      toast({ title: "Contatto non salvato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const elimina = async (lead) => {
    const ok = await conferma({
      title: `Eliminare ${lead.nome} ${lead.cognome}?`,
      description: "Il contatto sparisce anche dai conteggi dell'andamento.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.lead.elimina(lead.id);
      toast({ title: "Contatto eliminato" });
      carica();
    } catch (err) {
      toast({ title: "Contatto non eliminato", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  const mancaQualcosa = modulo && (soloTrattativa
    ? (!modulo.data_contatto || !modulo.canale_id ? "Indica giorno e canale del contatto." : null)
    : motivoLeadIncompleto(modulo));
  const nessunCanaleAttivo = !canali.some((c) => c.attivo);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {dialogoConferma}
      <PageHeader title="Contatti" description={`${leads.length} ${leads.length === 1 ? "contatto" : "contatti"}`}>
        {puoModificare && (
          <Button size="sm" onClick={() => apriModulo(nuovoLead())} disabled={nessunCanaleAttivo}>
            <Plus className="w-4 h-4 mr-1" /> Nuovo contatto
          </Button>
        )}
      </PageHeader>

      {nessunCanaleAttivo && puoModificare && (
        <p className="text-sm rounded-lg bg-warning/10 px-3 py-2">
          Per registrare un contatto serve almeno un canale attivo: <Link to="/lead/canali" className="text-primary font-medium hover:underline">aggiungilo nei canali</Link>.
        </p>
      )}

      {/* I filtri rapidi: la lista del lavoro del giorno. Un filtro vuoto si vede lo stesso,
          spento: sapere che non c'è niente da richiamare è un'informazione. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtri rapidi">
        {FILTRI_LEAD.map((f) => {
          const attivo = vista === f.valore;
          const n = conteggi[f.valore] ?? 0;
          return (
            <button
              key={f.valore} type="button" aria-pressed={attivo} onClick={() => scegliVista(f.valore)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                attivo ? "bg-primary text-primary-foreground border-primary"
                  : n > 0 ? "border-border hover:bg-muted/50" : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f.etichetta}
              <span className={`min-w-[1.25rem] px-1 rounded-full text-xs tabular-nums ${attivo ? "bg-primary-foreground/20" : "bg-muted"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input placeholder="Nome, telefono, email o nota..." value={cerca} onChange={(e) => setCerca(e.target.value)} className="pl-9" aria-label="Cerca contatti" />
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={Contact}
          title={leads.length === 0 ? "Nessun contatto" : cerca ? "Nessun contatto corrisponde" : "Niente qui"}
          description={leads.length === 0
            ? "Chi chiede informazioni, in sede, al telefono o sui social, si registra qui."
            : cerca ? `Nessun risultato per «${cerca}».` : "In questo filtro non c'è nessun contatto, oggi."}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="py-3 px-4 font-medium text-muted-foreground">Contatto</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Arrivato da</th>
                <th className="py-3 px-4"><span className="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              {visibili.map((l) => {
                const stato = statoLead(l.stato);
                const aperto = statoAperto(l.stato);
                const nome = `${l.nome} ${l.cognome}`;
                return (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4">
                    {/* Il nome apre il diario: stato, contatti e tutto quello che è successo. */}
                    <button type="button" onClick={() => setInDiario(l)} className="font-medium text-left hover:text-primary hover:underline">
                      {l.cognome} {l.nome}
                    </button>
                    {l.socio_id && (
                      <StatusBadge status="socio" label={l.socio_archiviato_il ? "Ex socio" : "Socio"} tone="neutro" className="ml-1.5 py-0" />
                    )}
                    {/* La nota non ha una colonna sua: è rara e corta. Si legge al passaggio del mouse. */}
                    {l.note && (
                      <span title={l.note} className="inline-flex align-middle ml-1.5 text-muted-foreground">
                        <StickyNote className="w-3.5 h-3.5" aria-hidden="true" />
                        <span className="sr-only">Nota: {l.note}</span>
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground">{[l.telefono, l.email].filter(Boolean).join(" · ") || "Nessun recapito"}</p>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={l.stato} label={stato.etichetta} tone={stato.tono} />
                    <p className="text-xs text-muted-foreground mt-1">{descriviTempoLead(l, oggi)}</p>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {nomeCanale.get(l.canale_id) ?? "—"}
                    <p className="text-xs text-muted-foreground">{formatData(l.data_contatto, "breve")}</p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      {puoModificare && aperto && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 whitespace-nowrap" onClick={() => setAzione({ lead: l, tipo: "contatto" })}>
                            <Phone className="w-3.5 h-3.5 mr-1" /> Contattato
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Da richiamare" aria-label={`Richiama ${nome}`} onClick={() => setAzione({ lead: l, tipo: "richiamo" })}>
                            <CalendarClock className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Non interessato" aria-label={`${nome} non è interessato`} onClick={() => setAzione({ lead: l, tipo: "chiudi" })}>
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                      {puoModificare && !aperto && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setInDiario(l)}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Riapri
                        </Button>
                      )}
                      {puoTrasformare && aperto && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" title="Iscrivi" aria-label={`Iscrivi ${nome}`} onClick={() => setDaTrasformare(l)}>
                          <UserCheck className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {puoModificare && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Modifica ${l.nome} ${l.cognome}`}
                            onClick={() => apriModulo({ ...l, cognome: l.cognome ?? "", sesso: l.sesso ?? "", telefono: l.telefono ?? "", email: l.email ?? "", anno_nascita: l.anno_nascita ?? "", note: l.note ?? "" })}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Elimina ${l.nome} ${l.cognome}`} onClick={() => elimina(l)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!modulo} onOpenChange={(aperto) => !aperto && apriModulo(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{modulo?.id ? "Modifica contatto" : "Nuovo contatto"}</DialogTitle></DialogHeader>
          {modulo && (
            <form onSubmit={salva} className="space-y-3">
              {soloTrattativa && (
                <p className="text-sm rounded-lg bg-muted/50 px-3 py-2">
                  {modulo.persona_collegata
                    ? <>Contatto di <strong>{modulo.persona_collegata.nome}</strong>, già nota alla palestra: i suoi dati restano quelli che ha. <button type="button" className="text-primary hover:underline" onClick={() => apriModulo(nuovoLead())}>Annulla</button></>
                    : <>I dati di {modulo.nome} si cambiano dalla <Link to={`/crm/soci/${modulo.socio_id}`} className="text-primary hover:underline">sua scheda da socio</Link>; qui solo il contatto.</>}
                </p>
              )}
              {!soloTrattativa && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-nome">Nome *</Label>
                  <Input id="lead-nome" required value={modulo.nome} onChange={(e) => setModulo({ ...modulo, nome: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="lead-cognome">Cognome</Label>
                  <Input id="lead-cognome" value={modulo.cognome} onChange={(e) => setModulo({ ...modulo, cognome: e.target.value })} />
                </div>
              </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-data">Giornata di contatto *</Label>
                  <Input id="lead-data" type="date" required value={modulo.data_contatto} onChange={(e) => setModulo({ ...modulo, data_contatto: e.target.value })} />
                </div>
                <div>
                  <Label>Canale di contatto *</Label>
                  <Select value={modulo.canale_id || undefined} onValueChange={(canale_id) => setModulo({ ...modulo, canale_id })}>
                    <SelectTrigger aria-label="Canale di contatto"><SelectValue placeholder="Scegli" /></SelectTrigger>
                    <SelectContent>
                      {canaliSceglibili.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}{c.attivo ? "" : " (disattivato)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!soloTrattativa && (<>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Sesso</Label>
                  <Select value={modulo.sesso || "nd"} onValueChange={(sesso) => setModulo({ ...modulo, sesso: sesso === "nd" ? "" : sesso })}>
                    <SelectTrigger aria-label="Sesso"><SelectValue placeholder="Scegli" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nd">Non indicato</SelectItem>
                      {SESSI.map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="lead-anno">Anno di nascita</Label>
                  <Input
                    id="lead-anno"
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={ANNO_CORRENTE}
                    value={modulo.anno_nascita}
                    onChange={(e) => setModulo({ ...modulo, anno_nascita: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-telefono">Telefono</Label>
                  <Input id="lead-telefono" type="tel" value={modulo.telefono} onBlur={cercaDoppioni} onChange={(e) => setModulo({ ...modulo, telefono: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="lead-email">Email</Label>
                  <Input id="lead-email" type="email" value={modulo.email} onBlur={cercaDoppioni} onChange={(e) => setModulo({ ...modulo, email: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">Serve almeno un recapito: telefono o email.</p>
              {doppioni.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm space-y-1.5" role="status">
                  <p className="font-medium">Questo recapito è già di:</p>
                  {doppioni.map((d) => (
                    <div key={d.persona_id} className="flex items-center justify-between gap-2">
                      <span>{d.nome} <span className="text-muted-foreground">· {TIPO_DOPPIONE[d.tipo]}</span></span>
                      {d.trattativa_aperta_id ? (
                        <Button
                          type="button" size="sm" variant="outline" className="h-7"
                          onClick={() => { const l = leads.find((x) => x.id === d.trattativa_aperta_id); apriModulo(null); if (l) setInDiario(l); }}
                        >
                          Apri il suo contatto
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => collega(d)}>È questa persona</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="lead-note">Note</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{modulo.note.length}/{NOTE_LEAD_MASSIMO}</span>
                </div>
                <Textarea
                  id="lead-note" rows={2} maxLength={NOTE_LEAD_MASSIMO} className="resize-none"
                  placeholder="Es. richiamare dopo le 18, chiede del corso bimbi"
                  value={modulo.note} onChange={(e) => setModulo({ ...modulo, note: e.target.value })}
                />
              </div>
              </>)}
              {mancaQualcosa && <p className="text-xs text-muted-foreground">{mancaQualcosa}</p>}
              <Button type="submit" className="w-full" disabled={Boolean(mancaQualcosa) || salvando}>
                {salvando ? "Salvataggio..." : "Salva"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AzioneLead richiesta={azione} onChiudi={() => setAzione(null)} onFatto={carica} />
      <DiarioLead
        lead={inDiario}
        nomeCanale={inDiario ? nomeCanale.get(inDiario.canale_id) : null}
        puoModificare={puoModificare}
        onChiudi={() => setInDiario(null)}
        onCambio={carica}
      />

      <TrasformaInSocio
        lead={daTrasformare}
        onChiudi={(fatto) => { setDaTrasformare(null); if (fatto) carica(); }}
      />
    </div>
  );
}
