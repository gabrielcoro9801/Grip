import React, { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Timer, StickyNote } from "lucide-react";
import { etichettaGruppo } from "@/lib/gruppiMuscolari";
import { formatDataOra } from "@/lib/format";
import { formatDurata, formatRecupero, statisticheAllenamento, durataSessione } from "@/lib/scheda";
import { cn } from "@/lib/utils";

/**
 * Un allenamento svolto, letto dal personal trainer: **prescritto accanto a eseguito**.
 *
 * È la vista da cui si decide se alzare il carico la settimana prossima, e per deciderlo
 * non basta sapere cosa è stato fatto: serve vederlo accanto a cosa era stato chiesto. Una
 * serie da 8 chiusa a 6 e una da 6 chiusa a 6 sono lo stesso numero e due fatti opposti.
 *
 * La routine arriva dalla scheda com'è **adesso**, quindi può essere cambiata dopo
 * l'allenamento: dove il confronto non è possibile si dice, invece di mostrare un
 * accostamento inventato.
 */
export default function DettaglioAllenamento({ sessione, righe, routine, onChiudi }) {
  const perEsercizio = useMemo(() => {
    if (!sessione) return [];

    // Le righe registrate, raccolte per posizione dell'esercizio nella routine.
    const raccolte = new Map();
    for (const riga of righe ?? []) {
      const chiave = riga.exercise_index ?? -1;
      if (!raccolte.has(chiave)) raccolte.set(chiave, []);
      raccolte.get(chiave).push(riga);
    }
    for (const elenco of raccolte.values()) {
      elenco.sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0));
    }

    const esercizi = routine?.esercizi ?? [];
    // Gli indici presenti da una parte o dall'altra: un esercizio previsto e mai iniziato
    // deve comparire lo stesso, perché "non l'ha fatto" è un'informazione.
    const indici = [...new Set([...esercizi.map((_, i) => i), ...raccolte.keys()])]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);

    return indici.map((indice) => ({
      indice,
      previsto: esercizi[indice] ?? null,
      // Il nome viene dalle righe quando l'esercizio non è più nella routine: la scheda è
      // stata modificata dopo, ma quello che il socio ha fatto resta leggibile.
      nome: esercizi[indice]?.exercise_name ?? raccolte.get(indice)?.[0]?.exercise_name ?? "Esercizio",
      gruppo: esercizi[indice]?.muscle_group ?? raccolte.get(indice)?.[0]?.muscle_group,
      fatte: raccolte.get(indice) ?? [],
    }));
  }, [sessione, righe, routine]);

  if (!sessione) return null;

  const { serie, volume } = statisticheAllenamento(righe);
  const previste = (routine?.esercizi ?? []).reduce((s, es) => s + (es.serie?.length ?? 0), 0);
  const note = (righe ?? []).find((r) => r.note)?.note;

  return (
    <Dialog open onOpenChange={(v) => !v && onChiudi()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{sessione.routine_name || "Allenamento"}</DialogTitle>
          <DialogDescription>
            {sessione.member_name ? `${sessione.member_name} · ` : ""}
            {sessione.plan_name} · {formatDataOra(sessione.iniziata_alle)}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-3 gap-2 border-y border-border py-3">
          <div>
            <dt className="text-xs text-muted-foreground">Durata</dt>
            <dd className="text-base font-semibold tabular-nums">
              {sessione.terminata_alle ? formatDurata(durataSessione(sessione)) : "in corso"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Volume</dt>
            <dd className="text-base font-semibold tabular-nums">
              {Math.round(volume).toLocaleString("it-IT")} kg
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Serie</dt>
            <dd className="text-base font-semibold tabular-nums">
              {serie}
              {previste > 0 && <span className="text-muted-foreground text-sm">/{previste}</span>}
            </dd>
          </div>
        </dl>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-1 px-1">
          {note && (
            <p className="text-sm text-muted-foreground italic flex items-start gap-1.5">
              <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              {note}
            </p>
          )}

          {perEsercizio.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nessuna serie registrata in questo allenamento.
            </p>
          ) : (
            perEsercizio.map((esercizio) => {
              const massimo = Math.max(
                esercizio.previsto?.serie?.length ?? 0,
                esercizio.fatte.length
              );
              return (
                <section key={esercizio.indice}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <h3 className="text-sm font-medium">{esercizio.nome}</h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {esercizio.gruppo && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {etichettaGruppo(esercizio.gruppo)}
                        </Badge>
                      )}
                      {esercizio.previsto?.recupero_secondi > 0 && (
                        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                          <Timer className="w-3 h-3" aria-hidden="true" />
                          {formatRecupero(esercizio.previsto.recupero_secondi)}
                        </span>
                      )}
                    </div>
                  </div>

                  {esercizio.previsto?.note && (
                    <p className="text-xs text-muted-foreground italic mb-1.5">{esercizio.previsto.note}</p>
                  )}

                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Serie previste ed eseguite di {esercizio.nome}</caption>
                      <thead>
                        <tr className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                          <th scope="col" className="text-left font-medium py-1.5 px-3 w-12">Serie</th>
                          <th scope="col" className="text-left font-medium py-1.5 px-2">Prescritto</th>
                          <th scope="col" className="text-left font-medium py-1.5 px-2">Eseguito</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: massimo }, (_, i) => {
                          const prevista = esercizio.previsto?.serie?.[i];
                          const fatta = esercizio.fatte.find((r) => (r.set_index ?? 0) === i);
                          return (
                            <tr key={i} className={cn("border-t border-border", !fatta && "opacity-60")}>
                              <td className="py-1.5 px-3 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                              <td className="py-1.5 px-2 text-xs text-muted-foreground">
                                {prevista
                                  ? `${prevista.reps || "—"} reps${prevista.rpe ? ` @ ${prevista.rpe} rpe` : ""}`
                                  : "serie in più"}
                              </td>
                              <td className="py-1.5 px-2 text-xs">
                                {fatta ? (
                                  <span className="font-medium">
                                    {fatta.peso_usato ? `${Number(fatta.peso_usato)}kg × ` : ""}
                                    {fatta.reps_fatte ?? "—"}
                                    {fatta.rpe_percepito ? ` @ ${Number(fatta.rpe_percepito)} rpe` : ""}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">non eseguita</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })
          )}

          {!routine && (
            <p className="text-xs text-muted-foreground italic">
              La routine di questo allenamento non è più nella scheda: qui sotto c'è quello che
              è stato registrato, senza il confronto con quanto era stato prescritto.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
