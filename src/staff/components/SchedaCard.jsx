import React from "react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { totaleSerieScheda, totaleEsercizi, gruppiDelleRoutine } from "@/core/domain/scheda";
import { CalendarDays } from "lucide-react";

/**
 * L'anteprima di una scheda in un elenco.
 *
 * Modelli e schede assegnate hanno lo stesso contenuto e vanno lette allo stesso modo:
 * un componente solo, e le azioni — assegna, duplica, elimina — arrivano da fuori, che è
 * l'unica cosa che davvero cambia fra i due elenchi.
 *
 * Quello che si mostra sono le **routine**, non gli esercizi: davanti a un elenco di
 * schede la domanda è "com'è divisa la settimana", e i singoli esercizi si guardano
 * aprendo la scheda.
 */
export default function SchedaCard({ scheda, sottotitolo, azioni, onApri }) {
  const routines = scheda.routines ?? [];
  const serie = totaleSerieScheda(routines);
  const esercizi = totaleEsercizi(routines);
  const gruppi = gruppiDelleRoutine(routines);

  return (
    <Card className="border-0 shadow-sm flex flex-col">
      <CardContent className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* Il titolo apre la scheda: è il gesto che ci si aspetta, e senza di esso
                l'unico modo di aprirla sarebbe centrare l'icona della matita. */}
            <button
              type="button"
              onClick={onApri}
              className="font-heading font-semibold text-left hover:text-primary transition-colors"
            >
              {scheda.name}
            </button>
            {sottotitolo && <p className="text-xs text-muted-foreground mt-0.5">{sottotitolo}</p>}
          </div>
          {azioni && <div className="flex items-center gap-0.5 shrink-0 -mt-1 -mr-2">{azioni}</div>}
        </div>

        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px] font-normal">
            {routines.length} {routines.length === 1 ? "routine" : "routine"} · {esercizi} es. · {serie} serie
          </Badge>
          {gruppi.slice(0, 3).map((g) => (
            <Badge key={g.codice} variant="outline" className="text-[10px] font-normal">{g.etichetta}</Badge>
          ))}
          {gruppi.length > 3 && (
            <Badge variant="outline" className="text-[10px] font-normal">+{gruppi.length - 3}</Badge>
          )}
        </div>

        {routines.length > 0 && (
          <div className="space-y-1">
            {routines.slice(0, 4).map((routine, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs p-2 rounded bg-muted/50">
                <span className="font-medium truncate inline-flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {routine.nome || `Giorno ${i + 1}`}
                </span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {routine.esercizi?.length ?? 0} es.
                </span>
              </div>
            ))}
            {routines.length > 4 && (
              <p className="text-xs text-muted-foreground pl-2">e altre {routines.length - 4}…</p>
            )}
          </div>
        )}

        {scheda.notes && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">{scheda.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
