import React, { useState } from "react";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Repeat } from "lucide-react";
import { formatData } from "@/core/domain/format";

// Le prenotazioni fisse nel portale: in Le mie lezioni, con fino a quando valgono e quante lezioni
// hanno prenotato. «Allunga» e il foglio con le date arrivano in D-4 (docs/piani/portale.md).

const NOMI = { Monday: "lunedì", Tuesday: "martedì", Wednesday: "mercoledì", Thursday: "giovedì", Friday: "venerdì", Saturday: "sabato", Sunday: "domenica" };
const nomeGiorno = (inglese) => NOMI[inglese] ?? inglese;

/**
 * L'elenco delle proprie fisse, con «Termina».
 * @param prenotate { [serie_id]: quante lezioni future ha prenotato quella fissa }
 */
export function LeMieFisse({ fisse, prenotate = {}, onTermina }) {
  const [chiedi, setChiedi] = useState(null);
  if (!fisse.length) return null;
  return (
    <section aria-labelledby="titolo-fisse" className="space-y-1">
      <h2 id="titolo-fisse" className="text-sm font-semibold flex items-center gap-2"><Repeat className="w-4 h-4 text-primary" aria-hidden="true" /> Prenotazioni fisse</h2>
      <Card className="border-0 shadow-sm">
        <CardContent className="px-4 py-1">
          <ul className="divide-y divide-border">
            {fisse.map((f) => {
              const n = prenotate[f.serie_id] ?? 0;
              return (
                <li key={f.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{f.corso} · ogni {f.giorni.map(nomeGiorno).join(" e ")} {f.inizio}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.al ? `Fino al ${formatData(f.al, "lungo")}` : "Senza fine"} · {n === 1 ? "1 lezione prenotata" : `${n} lezioni prenotate`}
                    </p>
                  </div>
                  {chiedi === f.id ? (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setChiedi(null)}>No</Button>
                      <Button size="sm" variant="destructive" className="min-h-11" onClick={() => { setChiedi(null); onTermina(f); }}>Sì, termina</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="shrink-0 min-h-11" onClick={() => setChiedi(f.id)}>Termina</Button>
                  )}
                </li>
              );
            })}
          </ul>
          {chiedi && <p className="text-xs text-muted-foreground pb-3">Terminando, le prossime lezioni di questa fissa vengono disdette (quelle ancora disdicibili).</p>}
        </CardContent>
      </Card>
    </section>
  );
}
