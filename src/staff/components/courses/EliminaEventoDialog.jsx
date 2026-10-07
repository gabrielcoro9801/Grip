import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { DAYS, DAYS_IT } from "@/staff/lib/courseValidation";
import { formatData } from "@/core/domain/format";
import { eUnaSerie, giorniInOrdine, elencoGiorni, descriviRimozione, hhmm } from "@/staff/lib/modificaEvento";

/**
 * Eliminare una lezione, o la sua serie. Si comporta come la modifica: di una serie si sceglie
 * se togliere solo la lezione cliccata o tutta la serie da oggi in poi, e di una settimanale in
 * quali giorni.
 *
 * Prima di confermare il server fa i conti (`anteprima`) e la finestra li racconta: quante
 * lezioni spariscono, quante hanno prenotati e verranno invece annullate, quanti soci riceveranno
 * un avviso nel portale. Le regole stanno nel server (lib/calendario.js), non qui.
 */
export default function EliminaEventoDialog({ lezione, data, onClose, onEliminato }) {
  const { events, courses } = data;
  const { toast } = useToast();
  const evento = lezione ? events.find((e) => e.id === lezione.event_id) : null;
  const corso = courses.find((c) => c.id === evento?.course_id);
  const serie = evento && eUnaSerie(evento);
  const settimanale = evento?.recurrence_type === "weekly";

  const [giorni, setGiorni] = useState([]);
  // I conti del server per le due scelte: { conti } o { errore }.
  const [anteprime, setAnteprime] = useState({});
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    if (lezione && evento) setGiorni(giorniInOrdine(evento.days_of_week));
  }, [lezione, evento]);

  // Le anteprime si richiedono all'apertura e a ogni cambio dei giorni (solo quella della serie).
  const chiedi = (ambito, extra = {}) =>
    api.calendario.elimina({ lezione_id: lezione.id, ambito, anteprima: true, ...extra })
      .then((conti) => ({ conti }))
      .catch((err) => ({ errore: err.message }));

  useEffect(() => {
    if (!lezione) return;
    let attivo = true;
    setAnteprime({});
    chiedi("lezione").then((r) => attivo && setAnteprime((p) => ({ ...p, lezione: r })));
    return () => { attivo = false; };
  }, [lezione]);

  useEffect(() => {
    if (!lezione || !serie) return;
    let attivo = true;
    setAnteprime((p) => ({ ...p, serie: undefined }));
    if (settimanale && giorni.length === 0) {
      setAnteprime((p) => ({ ...p, serie: { errore: "Scegli almeno un giorno." } }));
      return;
    }
    chiedi("serie", settimanale ? { giorni } : {}).then((r) => attivo && setAnteprime((p) => ({ ...p, serie: r })));
    return () => { attivo = false; };
  }, [lezione, serie, settimanale, giorni]);

  const elimina = async (ambito) => {
    setInCorso(true);
    try {
      const esito = await api.calendario.elimina({ lezione_id: lezione.id, ambito, ...(ambito === "serie" && settimanale ? { giorni } : {}) });
      const fatte = esito.eliminate + esito.annullate;
      toast({
        title: fatte === 1 ? "Lezione tolta dal calendario" : `${fatte} lezioni tolte dal calendario`,
        description: esito.soci_avvisati ? `${esito.soci_avvisati === 1 ? "1 socio avvisato" : `${esito.soci_avvisati} soci avvisati`} nel portale.` : undefined,
      });
      onEliminato();
      onClose();
    } catch (err) {
      toast({ title: "Eliminazione non riuscita", description: err.message, variant: "destructive" });
    }
    setInCorso(false);
  };

  const alterna = (g) => setGiorni((prima) => (prima.includes(g) ? prima.filter((d) => d !== g) : giorniInOrdine([...prima, g])));
  const tuttiIGiorni = !settimanale || giorni.length === giorniInOrdine(evento?.days_of_week).length;

  return (
    <Dialog open={!!lezione} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-md">
        {lezione && evento && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" />
                {serie ? "Eliminare dalla serie?" : "Eliminare la lezione?"}
              </DialogTitle>
              <DialogDescription>
                {corso?.name ?? "Lezione"} · {formatData(lezione.date, "estesa")}, {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}
              </DialogDescription>
            </DialogHeader>

            {settimanale && (
              <div>
                <Label>Giorni della serie da eliminare</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {DAYS.map((d) => {
                    const dellaSerie = (evento.days_of_week || []).includes(d);
                    const scelto = giorni.includes(d);
                    return (
                      <button
                        key={d} type="button" onClick={() => alterna(d)} disabled={!dellaSerie || inCorso} aria-pressed={scelto}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${scelto ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"} ${!dellaSerie ? "opacity-40 cursor-not-allowed hover:bg-muted" : ""}`}
                      >
                        {(DAYS_IT[d] || d).slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Valgono per "Tutta la serie". Le lezioni già tenute restano nello storico.</p>
              </div>
            )}

            <div className="space-y-2">
              {serie ? (
                <>
                  <Scelta
                    titolo="Solo questa lezione"
                    anteprima={anteprime.lezione}
                    disabled={inCorso}
                    onClick={() => elimina("lezione")}
                  />
                  <Scelta
                    titolo={`Tutta la serie, da oggi${!tuttiIGiorni && giorni.length ? ` (${elencoGiorni(giorni)})` : ""}`}
                    anteprima={anteprime.serie}
                    disabled={inCorso}
                    onClick={() => elimina("serie")}
                  />
                </>
              ) : (
                <Riepilogo anteprima={anteprime.lezione} />
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={inCorso}>Annulla</Button>
              {!serie && (
                <Button variant="destructive" onClick={() => elimina("lezione")} disabled={inCorso || !anteprime.lezione?.conti}>
                  {inCorso ? "Eliminazione..." : "Elimina"}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** I conti di un'anteprima, o il motivo per cui quella scelta non si può fare. */
function Riepilogo({ anteprima }) {
  if (!anteprima) return <span className="block text-sm text-muted-foreground">Calcolo in corso…</span>;
  if (anteprima.errore) return <span className="block text-sm text-muted-foreground">{anteprima.errore}</span>;
  const conAvvisi = anteprima.conti.annullate > 0;
  return (
    <span className={`text-sm flex items-start gap-2 ${conAvvisi ? "text-warning" : "text-muted-foreground"}`}>
      {conAvvisi && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <span>{descriviRimozione(anteprima.conti)}</span>
    </span>
  );
}

function Scelta({ titolo, anteprima, disabled, onClick }) {
  const pronta = anteprima?.conti;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled || !pronta}
      className="w-full text-left p-3 rounded-lg border border-border hover:border-destructive/50 hover:bg-destructive/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-border"
    >
      <span className="block font-medium text-sm">{titolo}</span>
      <span className="block mt-0.5"><Riepilogo anteprima={anteprima} /></span>
    </button>
  );
}
