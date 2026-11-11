import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit, canAccess } from "@/staff/lib/permissions";
import { DAYS_IT } from "@/staff/lib/courseValidation";
import { descriviRimozione } from "@/staff/lib/modificaEvento";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import PrenotazioniLezione from "@/staff/components/courses/PrenotazioniLezione";
import AggiungiPrenotazioneDialog from "@/staff/components/courses/AggiungiPrenotazioneDialog";
import { formatData } from "@/core/domain/format";
import { lezioneFinita } from "@/core/domain/giorni";

const hhmm = (t) => String(t ?? "").slice(0, 5);
const GRIGIO = "#6b7280";

/** "Ogni lunedì, dal 05/10/2026 al 21/12/2026": la sessione a cui la lezione appartiene. */
function descriviSessione(s) {
  const giorno = s.giorno ? `Ogni ${DAYS_IT[s.giorno]?.toLowerCase() ?? s.giorno}` : "A date scelte";
  const fine = s.end_condition === "by_count" && s.occurrence_count
    ? `, per ${s.occurrence_count} lezioni`
    : s.end_date ? ` al ${formatData(s.end_date, "breve")}` : "";
  return `${giorno}, dal ${formatData(s.start_date, "breve")}${fine} · ${s.start_time}–${s.end_time}`;
}

function Dato({ etichetta, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{etichetta}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/**
 * La pagina di una lezione: i dati, le etichette, le prenotazioni. Prima era una finestra sopra
 * il calendario, che leggeva tutto dagli elenchi del layout: una lezione vecchia di quattro mesi
 * non si poteva aprire. Ora la pagina chiede sempre al server (GET /api/calendario/lezioni/:id),
 * e un link a una lezione qualunque si apre comunque.
 *
 * Modifica ed Elimina toccano solo questa lezione: la sessione intera si cambia da Sessioni.
 */
export default function DettaglioLezione() {
  const { id } = useParams();
  const { data } = useOutletContext();
  const { categories, instructors, rooms } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const vedeSoci = canAccess(staffUser?.ruolo, "crm_members", "view");
  const navigate = useNavigate();

  const [dettaglio, setDettaglio] = useState(null); // { lezione, prenotazioni }
  const [errore, setErrore] = useState(null);
  const [inModifica, setInModifica] = useState(false);
  const [daEliminare, setDaEliminare] = useState(false);
  const [aggiungi, setAggiungi] = useState(false);

  const carica = useCallback(() => {
    setErrore(null);
    return api.calendario.lezione(id).then(setDettaglio).catch(setErrore);
  }, [id]);

  useEffect(() => { setDettaglio(null); carica(); }, [carica]);

  const indietro = `/calendario${dettaglio ? `?mese=${dettaglio.lezione.date.slice(0, 7)}` : ""}`;
  const tornaAlCalendario = (
    <Link to={indietro} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Calendario
    </Link>
  );

  if (errore && !dettaglio) {
    return (
      <>
        {tornaAlCalendario}
        <ErrorState
          error={errore}
          title={errore.status === 404 ? "Lezione non trovata" : undefined}
          onRetry={errore.status === 404 ? undefined : carica}
        />
      </>
    );
  }
  if (!dettaglio) return <LoadingState minHeight="h-64" label="Caricamento della lezione" />;

  const { lezione, prenotazioni } = dettaglio;
  const sessione = lezione.sessione;
  const singola = sessione.recurrence_type === "single";
  const finita = lezioneFinita(lezione);
  const annullata = lezione.status !== "active";
  const orarioDiverso = !singola && (hhmm(lezione.start_time) !== sessione.start_time || hhmm(lezione.end_time) !== sessione.end_time);
  const categoria = categories.find((c) => c.id === lezione.category_id);
  const istruttore = instructors.find((i) => i.id === lezione.instructor_id);
  const sala = rooms.find((r) => r.id === lezione.room_id);
  const colore = lezione.colore || GRIGIO;
  const modificabile = puoModificare && !finita && !annullata;

  return (
    <>
      {tornaAlCalendario}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colore }} aria-hidden="true" />
            <span className="truncate">{lezione.corso}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 capitalize">
            {formatData(lezione.date, "estesa")}, {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <StatusBadge status="tipo" tone={singola ? "neutro" : "info"} label={singola ? "Lezione singola" : "Sessione"} />
            {orarioDiverso && <StatusBadge status="orario" tone="attesa" label="Orario diverso dalla sessione" />}
            {annullata && <StatusBadge status="annullata" />}
            {finita && !annullata && <StatusBadge status="finita" tone="neutro" label="Finita" />}
          </div>
        </div>
        {modificabile && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="outline" onClick={() => setInModifica(true)}>
              <Pencil className="w-4 h-4 mr-1" aria-hidden="true" /> Modifica
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDaEliminare(true)}>
              <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" /> Elimina
            </Button>
          </div>
        )}
      </div>

      <Card className="border-0 shadow-sm mb-6">
        <CardContent className="p-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Dato etichetta="Sala">{sala?.name ?? "—"}</Dato>
            <Dato etichetta="Istruttore">{istruttore?.full_name ?? "—"}</Dato>
            <Dato etichetta="Categoria">{categoria?.name ?? "—"}</Dato>
            <Dato etichetta="Posti">
              {lezione.confermati}/{lezione.capacity} confermati
              {lezione.in_attesa > 0 && <span className="text-warning"> · {lezione.in_attesa} in lista d'attesa</span>}
            </Dato>
            {!singola && <Dato etichetta="Sessione">{descriviSessione(sessione)}</Dato>}
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="titolo-prenotazioni">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 id="titolo-prenotazioni" className="font-heading font-semibold text-lg">
            Prenotazioni <span className="text-muted-foreground font-normal tabular-nums">· {prenotazioni.filter((p) => p.status !== "cancelled").length}</span>
          </h2>
          {modificabile && (
            <Button size="sm" onClick={() => setAggiungi(true)}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi prenotazione
            </Button>
          )}
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="px-4 py-1">
            <PrenotazioniLezione
              prenotazioni={prenotazioni}
              modificabile={puoModificare && !finita}
              linkAlSocio={vedeSoci}
              onCambiato={carica}
            />
          </CardContent>
        </Card>
      </section>

      {modificabile && (
        <>
          <EventFormDialog
            modo="lezione" open={inModifica} lezione={lezione} data={data}
            onClose={() => setInModifica(false)} onSalvata={carica}
          />
          <AggiungiPrenotazioneDialog
            open={aggiungi} onClose={() => setAggiungi(false)}
            lezione={lezione} prenotazioni={prenotazioni} onPrenotato={carica}
          />
          <EliminaLezione
            lezione={daEliminare ? lezione : null}
            onClose={() => setDaEliminare(false)}
            onEliminata={(conti) => (conti.eliminate ? navigate(indietro, { replace: true }) : carica())}
          />
        </>
      )}
    </>
  );
}

/**
 * Togliere questa lezione. Prima i conti del server (`anteprima`): senza prenotati sparisce, con
 * prenotati resta annullata e i soci ricevono un avviso nel portale.
 */
function EliminaLezione({ lezione, onClose, onEliminata }) {
  const { toast } = useToast();
  const [anteprima, setAnteprima] = useState(null); // { conti } | { errore }
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    if (!lezione) return undefined;
    let vivo = true;
    setAnteprima(null);
    api.calendario.elimina({ lezione_id: lezione.id, ambito: "lezione", anteprima: true })
      .then((conti) => { if (vivo) setAnteprima({ conti }); })
      .catch((err) => { if (vivo) setAnteprima({ errore: err.message }); });
    return () => { vivo = false; };
  }, [lezione]);

  const elimina = async () => {
    setInCorso(true);
    try {
      const esito = await api.calendario.elimina({ lezione_id: lezione.id, ambito: "lezione" });
      toast({
        title: esito.eliminate ? "Lezione tolta dal calendario" : "Lezione annullata",
        description: esito.soci_avvisati ? `${esito.soci_avvisati === 1 ? "1 socio avvisato" : `${esito.soci_avvisati} soci avvisati`} nel portale.` : undefined,
      });
      onClose();
      onEliminata(esito);
    } catch (err) {
      toast({ title: "Eliminazione non riuscita", description: err.message, variant: "destructive" });
    }
    setInCorso(false);
  };

  const conAvvisi = anteprima?.conti?.annullate > 0;
  return (
    <Dialog open={!!lezione} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-md">
        {lezione && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" /> Eliminare la lezione?
              </DialogTitle>
              <DialogDescription>
                {lezione.corso} · {formatData(lezione.date, "estesa")}, {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}
              </DialogDescription>
            </DialogHeader>
            <p className={`text-sm flex items-start gap-2 ${conAvvisi ? "text-warning" : "text-muted-foreground"}`}>
              {conAvvisi && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              <span>
                {!anteprima ? "Calcolo in corso…" : anteprima.errore ?? descriviRimozione(anteprima.conti)}
              </span>
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={inCorso}>Annulla</Button>
              <Button variant="destructive" onClick={elimina} disabled={inCorso || !anteprima?.conti}>
                {inCorso ? "Eliminazione..." : "Elimina"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
