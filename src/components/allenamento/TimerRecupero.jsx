import React, { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Timer, X, Plus } from "lucide-react";
import { formatConteggio } from "@/lib/scheda";

/**
 * Il conto alla rovescia del recupero, ancorato in basso mentre si è sotto il bilanciere.
 *
 * Sta in fondo allo schermo e non dentro l'esercizio per un motivo pratico: chi si allena
 * scorre la scheda mentre recupera, e un timer che scorre via con la pagina è un timer che
 * si perde di vista proprio nel momento in cui serve.
 *
 * Il conteggio non si ferma se si cambia scheda del browser: `scadenza` è un istante, non
 * un contatore che scala. Un timer basato su quanti tick sono passati resterebbe indietro
 * ogni volta che il telefono sospende la pagina — cioè quasi sempre, in palestra.
 */
export default function TimerRecupero({ scadenza, durataSecondi, adesso, onAggiungi, onChiudi }) {
  const suonato = useRef(false);
  const secondiResidui = Math.max(0, (scadenza - adesso) / 1000);
  const finito = secondiResidui <= 0;

  // Una vibrazione a fine recupero: il telefono è in tasca o appoggiato, e nessuno sta
  // guardando lo schermo. Dove non è supportata (desktop, iOS) semplicemente non succede.
  useEffect(() => {
    if (finito && !suonato.current) {
      suonato.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    if (!finito) suonato.current = false;
  }, [finito]);

  // La barra si svuota: a colpo d'occhio dice quanto manca senza leggere i numeri.
  // `durataSecondi` è il recupero pieno di partenza, e cresce quando si aggiungono 15
  // secondi — senza, la barra farebbe un salto all'indietro a ogni prolungamento.
  const percentuale = finito ? 0 : Math.min(100, (secondiResidui / Math.max(1, durataSecondi)) * 100);

  return (
    <div
      role="status"
      aria-live="off"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="h-1 bg-muted">
        <div
          className={finito ? "h-full bg-success" : "h-full bg-primary transition-[width] duration-1000 ease-linear"}
          style={{ width: `${finito ? 100 : percentuale}%` }}
        />
      </div>
      <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-2.5">
        <Timer className={finito ? "w-5 h-5 text-success" : "w-5 h-5 text-primary"} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tabular-nums">
            {finito ? "Recupero finito" : formatConteggio(secondiResidui)}
          </p>
          <p className="text-xs text-muted-foreground">
            {finito ? "Puoi ripartire con la serie successiva" : "Recupero in corso"}
          </p>
        </div>
        {!finito && (
          <Button variant="outline" size="sm" onClick={() => onAggiungi(15)}>
            <Plus className="w-3.5 h-3.5 mr-0.5" aria-hidden="true" />15s
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onChiudi}
          aria-label={finito ? "Chiudi il timer" : "Salta il recupero"}>
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
