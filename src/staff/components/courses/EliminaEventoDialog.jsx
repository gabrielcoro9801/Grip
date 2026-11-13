import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { descriviRimozione } from "@/staff/lib/modificaEvento";

/**
 * Togliere una lezione, o una sessione intera da oggi in poi. Che cosa togliere lo decide chi
 * apre la finestra: la pagina della lezione toglie quella lezione, Sessioni la sessione. Prima
 * qui si sceglieva fra «solo questa» e «tutta la serie», e in quali giorni: ora una sessione ha
 * un giorno solo, e ognuna delle due cose ha il suo posto.
 *
 * Prima di confermare il server fa i conti (`anteprima`) e la finestra li racconta: quante
 * lezioni spariscono, quante hanno prenotati e verranno invece annullate, quanti soci riceveranno
 * un avviso nel portale. Le regole stanno nel server (lib/calendario.js), non qui.
 *
 * @param bersaglio { ambito: 'lezione', lezione_id } | { ambito: 'serie', evento_id }, più
 *   `titolo` e `descrizione` per l'intestazione; null = chiusa
 * @param onEliminato (esito) => void: { eliminate, annullate, soci_avvisati, evento_eliminato }
 */
export default function EliminaEventoDialog({ bersaglio, onClose, onEliminato }) {
  const { toast } = useToast();
  const [anteprima, setAnteprima] = useState(null); // { conti } | { errore }
  const [inCorso, setInCorso] = useState(false);

  const corpo = bersaglio
    ? (bersaglio.ambito === "lezione"
      ? { ambito: "lezione", lezione_id: bersaglio.lezione_id }
      : { ambito: "serie", evento_id: bersaglio.evento_id })
    : null;
  const chiave = corpo ? `${corpo.ambito}:${corpo.lezione_id ?? corpo.evento_id}` : null;

  useEffect(() => {
    if (!chiave) return undefined;
    let vivo = true;
    setAnteprima(null);
    api.calendario.elimina({ ...corpo, anteprima: true })
      .then((conti) => { if (vivo) setAnteprima({ conti }); })
      .catch((err) => { if (vivo) setAnteprima({ errore: err.message }); });
    return () => { vivo = false; };
    // `corpo` cambia a ogni disegno; la chiave no.
  }, [chiave]);

  const elimina = async () => {
    setInCorso(true);
    try {
      const esito = await api.calendario.elimina(corpo);
      const fatte = esito.eliminate + esito.annullate;
      toast({
        title: bersaglio.ambito === "lezione"
          ? (esito.eliminate ? "Lezione tolta dal calendario" : "Lezione annullata")
          : (esito.evento_eliminato ? "Sessione eliminata" : `${fatte === 1 ? "1 lezione tolta" : `${fatte} lezioni tolte`} dalla sessione`),
        description: esito.soci_avvisati ? `${esito.soci_avvisati === 1 ? "1 socio avvisato" : `${esito.soci_avvisati} soci avvisati`} nel portale.` : undefined,
      });
      onClose();
      onEliminato?.(esito);
    } catch (err) {
      toast({ title: "Eliminazione non riuscita", description: err.message, variant: "destructive" });
    }
    setInCorso(false);
  };

  const conAvvisi = anteprima?.conti?.annullate > 0;
  const sessione = bersaglio?.ambito === "serie";
  return (
    <Dialog open={!!bersaglio} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-md">
        {bersaglio && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" />
                {bersaglio.titolo ?? (sessione ? "Eliminare la sessione?" : "Eliminare la lezione?")}
              </DialogTitle>
              {bersaglio.descrizione && <DialogDescription>{bersaglio.descrizione}</DialogDescription>}
            </DialogHeader>
            {sessione && (
              <p className="text-sm text-muted-foreground">
                Si tolgono le lezioni da oggi in poi; quelle già tenute restano nello storico. Le prenotazioni fisse della sessione si chiudono.
              </p>
            )}
            <p className={`text-sm flex items-start gap-2 ${conAvvisi ? "text-warning" : "text-muted-foreground"}`}>
              {conAvvisi && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{!anteprima ? "Calcolo in corso…" : anteprima.errore ?? descriviRimozione(anteprima.conti)}</span>
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
