import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { LoadingState } from "@/ui/Spinner";
import { nomeGiorno, hhmm } from "@/staff/lib/modificaEvento";
import { periodoFissa } from "@/staff/lib/fisse";
import FissaFormDialog from "@/staff/components/courses/FissaFormDialog";
import CancellaFissaDialog from "@/staff/components/courses/CancellaFissaDialog";

/**
 * Le prenotazioni fisse di una sessione: chi tiene il posto, da quando a quando. Da qui se ne
 * crea una per conto di un socio, se ne cambia il periodo, la si cancella da un giorno in poi.
 *
 * Prima, in Gestione corsi, le fisse non si vedevano: si creavano solo dalla scheda del socio o
 * dal portale.
 *
 * @param sessione la sessione (GET /api/calendario/sessioni), null = chiusa
 * @param onCambiato () => void, dopo ogni modifica: il numero sulla riga cambia
 */
export default function FisseSessioneDialog({ sessione, puoModificare, onClose, onCambiato }) {
  const [fisse, setFisse] = useState(null); // [] | { errore }
  const [nuova, setNuova] = useState(false);
  const [inModifica, setInModifica] = useState(null);
  const [daCancellare, setDaCancellare] = useState(null);

  const carica = useCallback(() => {
    if (!sessione) return;
    api.prenotazioniFisse.elenco({ event_id: sessione.id })
      .then((r) => setFisse(r.fisse))
      .catch((err) => setFisse({ errore: err.message }));
  }, [sessione]);

  useEffect(() => { setFisse(null); carica(); }, [carica]);

  const cambiato = () => { carica(); onCambiato?.(); };
  const elenco = Array.isArray(fisse) ? fisse : [];
  const giaConFissa = useMemo(() => new Set(elenco.map((f) => f.member_id)), [elenco]);
  // Le finestre sopra questa: mentre sono aperte, questa si nasconde.
  const sopra = nuova || !!inModifica || !!daCancellare;

  return (
    <>
      <Dialog open={!!sessione && !sopra} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {sessione && (
            <>
              <DialogHeader>
                <DialogTitle>Prenotazioni fisse</DialogTitle>
                <DialogDescription>
                  {sessione.corso} · {sessione.giorno ? `ogni ${nomeGiorno(sessione.giorno)}` : "date scelte"} {hhmm(sessione.start_time)}–{hhmm(sessione.end_time)}
                </DialogDescription>
              </DialogHeader>
              {fisse === null ? (
                <LoadingState minHeight="h-24" label="Caricamento delle fisse" />
              ) : fisse.errore ? (
                <p role="alert" className="text-sm text-destructive">Fisse non caricate: {fisse.errore}</p>
              ) : elenco.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna prenotazione fissa in questa sessione.</p>
              ) : (
                <ul className="rounded-lg border border-border divide-y divide-border">
                  {elenco.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <div className="flex-1 min-w-[10rem]">
                        <p className="text-sm font-medium">
                          {f.socio} <span className="text-xs font-normal text-muted-foreground tabular-nums">· {f.codice_socio}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{periodoFissa(f)}</p>
                      </div>
                      {puoModificare && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifica la fissa di ${f.socio}`} onClick={() => setInModifica(f)}>
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                            aria-label={`Cancella la fissa di ${f.socio}`} onClick={() => setDaCancellare(f)}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Chiudi</Button>
                {puoModificare && (
                  <Button onClick={() => setNuova(true)}>
                    <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuova prenotazione fissa
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {sessione && (
        <>
          <FissaFormDialog
            open={nuova || !!inModifica} onClose={() => { setNuova(false); setInModifica(null); }}
            sessione={sessione} fissa={inModifica} giaConFissa={giaConFissa} onSalvata={cambiato}
          />
          <CancellaFissaDialog fissa={daCancellare} onClose={() => setDaCancellare(null)} onCancellata={cambiato} />
        </>
      )}
    </>
  );
}
