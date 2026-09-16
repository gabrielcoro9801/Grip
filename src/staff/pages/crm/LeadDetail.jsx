import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import CampiLead, { modificabili } from "@/staff/components/lead/CampiLead";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { logAction } from "@/staff/lib/auditLog";
import { getSessionAvailability } from "@/core/domain/bookingUtils";
import { formatData, formatDataOra, toIsoDate } from "@/core/domain/format";
import {
  MOTIVI_PERDITA, TIPI_ATTIVITA_MANUALI, transizioniManuali, puoPrenotareProva, puoConvertire,
  etichettaFonte, etichettaMotivo, etichettaAttivita, spostaData,
} from "@/core/domain/lead";
import {
  ArrowLeft, CalendarPlus, UserCheck, XCircle, History, CalendarDays, Shield, Save, Check, X,
} from "lucide-react";

const TUTTI_I_CORSI = "tutti";
// Quanto avanti guardare quando si sceglie la lezione per una prova: oltre un mese, chi è
// passato a chiedere ha già deciso altro.
const GIORNI_PRENOTABILI = 30;

// Cosa dice il pulsante per ogni passaggio manuale. "perso" ha la sua finestra, col motivo.
const AZIONE_STATO = {
  contattato: "Segna come contattato",
  proposta: "Proposta fatta",
};

const ora = (t) => (t ? String(t).slice(0, 5) : "");

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { staffUser } = useStaffAuth();
  const [conferma, dialogoConferma] = useConfirm();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_leads");

  const [lead, setLead] = useState(null);
  const [form, setForm] = useState(null);
  const [attivita, setAttivita] = useState([]);
  const [corsi, setCorsi] = useState([]);
  const [eventi, setEventi] = useState([]);
  const [lezioni, setLezioni] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  const [occupato, setOccupato] = useState(false);
  const [nota, setNota] = useState({ tipo: "chiamata", testo: "" });
  const [sceltaProva, setSceltaProva] = useState(null); // corso filtrato, o null se chiusa
  const [perdita, setPerdita] = useState(null); // motivo scelto, o null se chiusa

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([
      api.entities.Lead.get(id),
      api.entities.LeadAttivita.filter({ lead_id: id }, "-created_date"),
      api.entities.Course.list(),
      api.entities.Event.list(),
      api.entities.Session.list(),
      api.entities.Booking.list(),
    ])
      .then(([l, a, c, e, s, b]) => {
        setLead(l);
        setForm(modificabili(l));
        setAttivita(a);
        setCorsi(c);
        setEventi(e);
        setLezioni(s);
        setPrenotazioni(b);
      })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { carica(); }, [carica]);

  const oggi = toIsoDate(new Date());
  const lezionePerId = useMemo(() => new Map(lezioni.map((s) => [s.id, s])), [lezioni]);
  const corsoDellaLezione = useMemo(() => {
    const corsoPerId = new Map(corsi.map((c) => [c.id, c]));
    const corsoPerEvento = new Map(eventi.map((e) => [e.id, corsoPerId.get(e.course_id)]));
    return (lezione) => corsoPerEvento.get(lezione?.event_id) ?? null;
  }, [corsi, eventi]);

  const prove = useMemo(
    () => prenotazioni
      .filter((b) => b.lead_id === id)
      .map((b) => ({ ...b, lezione: lezionePerId.get(b.session_id) }))
      .sort((a, b) => `${b.lezione?.date}${b.lezione?.start_time}`.localeCompare(`${a.lezione?.date}${a.lezione?.start_time}`)),
    [prenotazioni, id, lezionePerId]
  );

  const lezioniPrenotabili = useMemo(() => {
    if (!sceltaProva) return [];
    const fine = spostaData(oggi, GIORNI_PRENOTABILI);
    const giaPrenotate = new Set(prove.filter((p) => p.status !== "cancelled").map((p) => p.session_id));
    return lezioni
      .filter((s) => s.status !== "cancelled" && s.date >= oggi && s.date <= fine)
      .map((s) => ({ lezione: s, corso: corsoDellaLezione(s) }))
      .filter(({ corso }) => sceltaProva === TUTTI_I_CORSI || corso?.id === sceltaProva)
      .sort((a, b) => `${a.lezione.date}${a.lezione.start_time}`.localeCompare(`${b.lezione.date}${b.lezione.start_time}`))
      .slice(0, 60)
      .map((r) => ({ ...r, posti: getSessionAvailability(r.lezione, prenotazioni), giaPrenotata: giaPrenotate.has(r.lezione.id) }));
  }, [sceltaProva, lezioni, prenotazioni, prove, corsoDellaLezione, oggi]);

  // Ogni azione ricarica tutto: stato, prove e cronologia cambiano insieme sul server, e
  // aggiornarne a mano solo un pezzo lascerebbe la pagina a raccontare metà della storia.
  const agisci = async (operazione, messaggio) => {
    setOccupato(true);
    try {
      const esito = await operazione();
      if (messaggio) toast({ title: messaggio });
      carica();
      return esito;
    } catch (err) {
      toast({ title: "Operazione non riuscita", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setOccupato(false);
    }
  };

  const salvaAnagrafica = (e) => {
    e.preventDefault();
    agisci(() => api.entities.Lead.update(id, form), "Scheda salvata");
  };

  const aggiungiNota = (e) => {
    e.preventDefault();
    agisci(async () => {
      await api.lead.annota(id, nota);
      setNota({ ...nota, testo: "" });
    }, "Aggiunta alla cronologia");
  };

  const prenotaProva = (lezione) => agisci(async () => {
    const { booking } = await api.lead.prenotaProva(id, lezione.id);
    setSceltaProva(null);
    if (booking.status === "waitlisted") {
      toast({ title: "Lezione al completo", description: `Prova in lista d'attesa, posizione ${booking.waitlist_position}.` });
    }
    return booking;
  }, "Prova prenotata");

  const disdiciProva = async (prova) => {
    const ok = await conferma({
      title: "Disdire la prova?",
      description: "Il posto si libera, e se qualcuno è in lista d'attesa entra al suo posto.",
      confirmLabel: "Disdici",
      destructive: true,
    });
    if (ok) agisci(() => api.lead.disdiciProva(id, prova.id), "Prova disdetta");
  };

  const segnaPerso = (e) => {
    e.preventDefault();
    agisci(async () => {
      await api.lead.cambiaStato(id, { stato: "perso", motivoPerdita: perdita });
      setPerdita(null);
    }, "Contatto segnato come perso");
  };

  const converti = async () => {
    const ok = await conferma({
      title: `Iscrivere ${lead.full_name} come socio?`,
      description: "Nasce un socio con il suo codice; le prove già fatte restano qui, le prenotazioni future passano a lui.",
      confirmLabel: "Iscrivi",
    });
    if (!ok) return;
    const esito = await agisci(() => api.lead.converti(id), "Iscritto come socio");
    if (esito?.member) {
      await logAction(staffUser, "create", "member", esito.member.full_name, esito.member.id, "Socio creato da lead");
      navigate(`/crm/soci/${esito.member.id}`);
    }
  };

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) {
    return errore.status === 404
      ? <div className="p-8 text-center text-muted-foreground">Lead non trovato</div>
      : <ErrorState error={errore} onRetry={carica} />;
  }

  const passaggi = transizioniManuali(lead.stato);
  const aperto = lead.stato !== "iscritto";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {dialogoConferma}
      <Link to="/crm/lead" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Torna ai lead
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-heading font-bold">{lead.full_name}</h1>
            <StatusBadge status={lead.stato} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
            {lead.phone && <span>{lead.phone}</span>}
            {lead.email && <span>{lead.email}</span>}
            <span>{etichettaFonte(lead.fonte)}{lead.fonte_dettaglio ? ` — ${lead.fonte_dettaglio}` : ""}</span>
            <span>Arrivato il {formatData(lead.created_date, "media")}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline" className={`text-xs ${lead.consenso_privacy ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
              <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
              {lead.consenso_privacy ? "Consenso al trattamento" : "Nessun consenso al trattamento"}
            </Badge>
            {lead.consenso_marketing && (
              <Badge variant="outline" className="text-xs bg-info/10 text-info border-info/30">Consenso promozioni</Badge>
            )}
            {lead.stato === "perso" && lead.motivo_perdita && (
              <Badge variant="outline" className="text-xs">Motivo: {etichettaMotivo(lead.motivo_perdita)}</Badge>
            )}
          </div>
          {lead.convertito_member_id && (
            <p className="mt-3 text-sm">
              Iscritto il {formatData(lead.convertito_il, "media")} —{" "}
              <Link to={`/crm/soci/${lead.convertito_member_id}`} className="text-primary font-medium hover:underline">apri la scheda del socio</Link>
            </p>
          )}
        </div>

        {puoModificare && aperto && (
          <div className="flex flex-wrap gap-2">
            {puoPrenotareProva(lead.stato) && (
              <Button size="sm" disabled={occupato} onClick={() => setSceltaProva(lead.corso_interesse_id || TUTTI_I_CORSI)}>
                <CalendarPlus className="w-4 h-4 mr-1" /> Prenota prova
              </Button>
            )}
            {puoConvertire(lead.stato) && (
              <Button size="sm" variant="outline" disabled={occupato} onClick={converti}>
                <UserCheck className="w-4 h-4 mr-1" /> Iscrivi come socio
              </Button>
            )}
            {passaggi.filter((s) => AZIONE_STATO[s]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                disabled={occupato}
                onClick={() => agisci(() => api.lead.cambiaStato(id, { stato: s }), "Stato aggiornato")}
              >
                {lead.stato === "perso" && s === "contattato" ? "Riapri il contatto" : AZIONE_STATO[s]}
              </Button>
            ))}
            {passaggi.includes("perso") && (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={occupato} onClick={() => setPerdita(MOTIVI_PERDITA[0].valore)}>
                <XCircle className="w-4 h-4 mr-1" /> Perso
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-heading flex items-center gap-2">
                <CalendarDays className="w-4 h-4" /> Prove
              </CardTitle>
            </CardHeader>
            <CardContent>
              {prove.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nessuna prova prenotata</p>
              ) : (
                <ul className="space-y-3">
                  {prove.map((p) => {
                    const data = p.lezione?.date;
                    const passata = data && data <= oggi;
                    const attiva = p.status !== "cancelled";
                    return (
                      <li key={p.id} className="p-3 rounded-lg bg-muted/50 flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{corsoDellaLezione(p.lezione)?.name ?? "Corso"}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatData(data, "giorno")} {ora(p.lezione?.start_time)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={p.status} />
                          {p.presenza && <StatusBadge status={p.presenza} />}
                          {puoModificare && attiva && passata && (
                            <>
                              <Button size="sm" variant="outline" disabled={occupato} onClick={() => agisci(() => api.lead.esitoProva(id, p.id, "presente"), "Presenza segnata")}>
                                <Check className="w-3.5 h-3.5 mr-1" /> Presente
                              </Button>
                              <Button size="sm" variant="outline" disabled={occupato} onClick={() => agisci(() => api.lead.esitoProva(id, p.id, "assente"), "Assenza segnata")}>
                                <X className="w-3.5 h-3.5 mr-1" /> Assente
                              </Button>
                            </>
                          )}
                          {puoModificare && attiva && !passata && aperto && (
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={occupato} onClick={() => disdiciProva(p)}>
                              Disdici
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-heading flex items-center gap-2">
                <History className="w-4 h-4" /> Cronologia
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {puoModificare && (
                <form onSubmit={aggiungiNota} className="space-y-2">
                  <div className="flex gap-2">
                    <Select value={nota.tipo} onValueChange={(tipo) => setNota({ ...nota, tipo })}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIPI_ATTIVITA_MANUALI.map((t) => <SelectItem key={t} value={t}>{etichettaAttivita(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="submit" size="sm" className="ml-auto" disabled={occupato || !nota.testo.trim()}>Aggiungi</Button>
                  </div>
                  <Label htmlFor="lead-nota" className="sr-only">Cosa è successo</Label>
                  <Textarea
                    id="lead-nota"
                    rows={2}
                    placeholder="Es. richiamato, vuole provare il corso del martedì sera"
                    value={nota.testo}
                    onChange={(e) => setNota({ ...nota, testo: e.target.value })}
                  />
                </form>
              )}
              {attivita.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 text-center">Ancora niente</p>
              ) : (
                <ol className="space-y-3">
                  {attivita.map((a) => (
                    <li key={a.id} className="border-l-2 border-border pl-3">
                      <p className="text-xs text-muted-foreground">
                        {etichettaAttivita(a.tipo)} · {formatDataOra(a.created_date)}{a.autore_nome ? ` · ${a.autore_nome}` : ""}
                      </p>
                      <p className="text-sm whitespace-pre-line">{a.testo}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading">Scheda</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={salvaAnagrafica} className="space-y-4">
              <fieldset disabled={!puoModificare} className="contents">
                <CampiLead valori={form} onChange={setForm} corsi={corsi} />
              </fieldset>
              {puoModificare && (
                <Button type="submit" size="sm" disabled={occupato}>
                  <Save className="w-4 h-4 mr-1" /> Salva
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      <Dialog open={sceltaProva !== null} onOpenChange={(v) => !v && setSceltaProva(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Prenota una prova</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={sceltaProva ?? TUTTI_I_CORSI} onValueChange={setSceltaProva}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TUTTI_I_CORSI}>Tutti i corsi</SelectItem>
                {corsi.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {lezioniPrenotabili.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nessuna lezione nei prossimi {GIORNI_PRENOTABILI} giorni{sceltaProva !== TUTTI_I_CORSI ? " per questo corso" : ""}.
              </p>
            ) : (
              <ul className="space-y-2">
                {lezioniPrenotabili.map(({ lezione, corso, posti, giaPrenotata }) => (
                  <li key={lezione.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{corso?.name ?? "Corso"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatData(lezione.date, "giorno")} {ora(lezione.start_time)}–{ora(lezione.end_time)} ·{" "}
                        {posti.isFull
                          ? `Al completo${posti.waitlisted ? `, ${posti.waitlisted} in attesa` : ""}`
                          : `${posti.available} ${posti.available === 1 ? "posto libero" : "posti liberi"}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={posti.isFull ? "outline" : "default"}
                      disabled={occupato || giaPrenotata}
                      onClick={() => prenotaProva(lezione)}
                    >
                      {giaPrenotata ? "Già prenotata" : posti.isFull ? "Lista d'attesa" : "Prenota"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={perdita !== null} onOpenChange={(v) => !v && setPerdita(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Perché si è perso?</DialogTitle></DialogHeader>
          <form onSubmit={segnaPerso} className="space-y-4">
            <Select value={perdita ?? ""} onValueChange={setPerdita}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOTIVI_PERDITA.map((m) => <SelectItem key={m.valore} value={m.valore}>{m.etichetta}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="submit" variant="destructive" className="w-full" disabled={occupato}>Segna come perso</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
