import React, { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { formatData } from "@/core/domain/format";
import { massimaleStimato, tipoSerie } from "@/core/domain/scheda";

/**
 * Come è andato un esercizio nel tempo.
 *
 * Si guarda il **massimale stimato** e non i chili sollevati: cambiando le ripetizioni da
 * una settimana all'altra il peso sale e scende senza dire niente, mentre 80×8 e 90×5 sono
 * confrontabili una volta ridotti alla stessa misura. È la stessa formula con cui si
 * decide il record.
 *
 * Una serie sola per allenamento — la migliore — perché il grafico deve rispondere a "sto
 * migliorando", non "cosa ho fatto quel giorno": con tutte le serie il riscaldamento e le
 * serie di scarico farebbero seghettare la linea senza aggiungere niente.
 */
export default function ProgressiEsercizio({ nomeEsercizio, righe, onChiudi }) {
  const punti = useMemo(() => {
    const perGiorno = new Map();
    for (const riga of righe ?? []) {
      if (riga.exercise_name !== nomeEsercizio) continue;
      if (!tipoSerie(riga.tipo_serie).volume) continue;
      const stimato = massimaleStimato(riga.peso_usato, riga.reps_fatte);
      if (stimato === null) continue;
      const corrente = perGiorno.get(riga.data);
      if (!corrente || stimato > corrente.massimale) {
        perGiorno.set(riga.data, {
          data: riga.data,
          massimale: stimato,
          peso: Number(riga.peso_usato),
          reps: Number(riga.reps_fatte),
        });
      }
    }
    return [...perGiorno.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }, [righe, nomeEsercizio]);

  const primo = punti[0];
  const ultimo = punti[punti.length - 1];
  const differenza = primo && ultimo ? Math.round((ultimo.massimale - primo.massimale) * 10) / 10 : 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onChiudi()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{nomeEsercizio}</DialogTitle>
          <DialogDescription>
            Massimale stimato, una serie per allenamento: la migliore.
          </DialogDescription>
        </DialogHeader>

        {punti.length < 2 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Serve più di un allenamento per disegnare un andamento. Continua a registrare.
          </p>
        ) : (
          <>
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{ultimo.massimale}</span>
              <span className="text-muted-foreground"> kg stimati</span>
              {differenza !== 0 && (
                <span className={differenza > 0 ? "text-success ml-2" : "text-muted-foreground ml-2"}>
                  {differenza > 0 ? "+" : ""}{differenza} kg dal primo allenamento
                </span>
              )}
            </p>

            {/* Una serie sola: nessuna legenda, il titolo la nomina già. Il colore viene
                dal token del tema, quindi la linea resta leggibile anche in scuro. */}
            <div className="h-56 -ml-2 text-chart-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={punti} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis
                    dataKey="data"
                    tickFormatter={(v) => formatData(v, "giornoBreve")}
                    className="text-[10px] fill-muted-foreground"
                    stroke="currentColor"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    className="text-[10px] fill-muted-foreground"
                    stroke="currentColor"
                    tickLine={false}
                    axisLine={false}
                    width={38}
                    domain={["dataMin - 5", "dataMax + 5"]}
                    tickFormatter={(v) => Math.round(v)}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      fontSize: "12px",
                      borderRadius: "0.5rem",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      color: "hsl(var(--popover-foreground))",
                    }}
                    labelFormatter={(v) => formatData(v, "media")}
                    formatter={(valore, _nome, voce) => [
                      `${valore} kg stimati — ${voce.payload.peso}kg × ${voce.payload.reps}`,
                      "",
                    ]}
                  />
                  {/* currentColor e non una variabile CSS nell'attributo: var() non viene
                      risolta dentro gli attributi di presentazione SVG, e la linea
                      resterebbe nera. Il colore arriva dalla classe sul contenitore. */}
                  <Line
                    type="monotone"
                    dataKey="massimale"
                    stroke="currentColor"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "currentColor", strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Gli stessi numeri leggibili senza vedere il grafico. */}
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">Vedi i numeri</summary>
              <div className="overflow-x-auto">
              <table className="w-full mt-2">
                <caption className="sr-only">Massimale stimato di {nomeEsercizio}, allenamento per allenamento</caption>
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th scope="col" className="font-medium py-1">Data</th>
                    <th scope="col" className="font-medium py-1">Serie migliore</th>
                    <th scope="col" className="font-medium py-1 text-right">Stimato</th>
                  </tr>
                </thead>
                <tbody>
                  {[...punti].reverse().map((punto) => (
                    <tr key={punto.data} className="border-t border-border">
                      <td className="py-1">{formatData(punto.data, "media")}</td>
                      <td className="py-1">{punto.peso}kg × {punto.reps}</td>
                      <td className="py-1 text-right tabular-nums">{punto.massimale} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </details>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
