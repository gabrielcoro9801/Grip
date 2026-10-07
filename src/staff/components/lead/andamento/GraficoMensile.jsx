import React, { useState } from "react";
import { COLORI, Legenda, Riquadro, InterruttoreTabella, useSuggerimento, n } from "./comuni";

const ALTEZZA = 180;

/** Tre o quattro righe di griglia a numeri tondi, fino al massimo. */
function tacche(massimo) {
  if (massimo <= 0) return [0];
  const passo = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((p) => massimo / p <= 4) ?? Math.ceil(massimo / 4);
  const valori = [];
  for (let v = 0; v <= massimo + passo - 1 && valori.length < 6; v += passo) valori.push(v);
  return valori;
}

/**
 * Mese per mese: i contatti, quanti di loro sono diventati soci, e i contatti dello stesso mese
 * dell'anno prima come linea di riferimento. Un asse solo: sono tutte persone.
 *
 * Un clic su un mese lo usa come filtro per tutta la pagina (un altro clic lo toglie).
 */
export default function GraficoMensile({ serie, meseScelto, onScegliMese }) {
  const [tabella, setTabella] = useState(false);
  const { eventi, elemento } = useSuggerimento();
  const valori = tacche(Math.max(1, ...serie.flatMap((m) => [m.contatti, m.soci, m.annoPrima])));
  const scala = valori[valori.length - 1] || 1;
  const y = (v) => ALTEZZA - (v / scala) * ALTEZZA;
  const picco = serie.reduce((max, m, i) => (m.contatti > (serie[max]?.contatti ?? -1) ? i : max), 0);
  const punti = serie.map((m, i) => `${i + 0.5},${y(m.annoPrima)}`).join(" ");

  return (
    <Riquadro
      titolo="Mese per mese"
      sottotitolo="Clic su un mese per vedere solo quello, in tutta la pagina"
      azioni={(
        <>
          <Legenda voci={[
            { etichetta: "Contatti", colore: COLORI.contatti },
            { etichetta: "Diventati soci", colore: COLORI.soci },
            { etichetta: "Contatti l'anno prima", colore: COLORI.riferimento, linea: true },
          ]} />
          <InterruttoreTabella tabella={tabella} onCambia={setTabella} />
        </>
      )}
    >
      {tabella ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Mese</th>
                <th className="py-2 pr-4 font-medium text-right">Contatti</th>
                <th className="py-2 pr-4 font-medium text-right">Diventati soci</th>
                <th className="py-2 font-medium text-right">L'anno prima</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((m) => (
                <tr key={m.mese} className="border-b border-border/50">
                  <td className="py-1.5 pr-4">{m.etichettaLunga}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{n(m.contatti)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{n(m.soci)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{n(m.annoPrima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* L'asse: poche tacche a numeri tondi, in testo attenuato. */}
          <div className="relative w-8 shrink-0 text-[11px] text-muted-foreground tabular-nums" style={{ height: ALTEZZA }} aria-hidden="true">
            {valori.map((v) => (
              <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: y(v) }}>{n(v)}</span>
            ))}
          </div>
          <div className="relative flex-1 min-w-0" data-grafico>
            <div className="relative" style={{ height: ALTEZZA }}>
              {valori.map((v) => (
                <div key={v} className="absolute inset-x-0 border-t border-border" style={{ top: y(v) }} aria-hidden="true" />
              ))}
              <ul className="absolute inset-0 flex" aria-label="Contatti e soci per mese">
                {serie.map((m, i) => {
                  const spento = meseScelto && meseScelto !== m.mese;
                  return (
                    <li key={m.mese} className="flex-1 min-w-0 h-full">
                      <button
                        type="button"
                        onClick={() => onScegliMese(meseScelto === m.mese ? null : m.mese)}
                        aria-pressed={meseScelto === m.mese}
                        aria-label={`${m.etichettaLunga}: ${m.contatti} contatti, ${m.soci} diventati soci; l'anno prima ${m.annoPrima}`}
                        className={`relative w-full h-full flex items-end justify-center gap-0.5 px-[12%] rounded-md hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring transition-opacity ${spento ? "opacity-35" : ""}`}
                        {...eventi(
                          <div className="space-y-0.5">
                            <p className="font-medium">{m.etichettaLunga}</p>
                            <p>{n(m.contatti)} contatti · {n(m.soci)} diventati soci</p>
                            <p className="text-muted-foreground">L'anno prima: {n(m.annoPrima)} contatti</p>
                          </div>,
                        )}
                      >
                        {[["contatti", COLORI.contatti], ["soci", COLORI.soci]].map(([campo, colore]) => (
                          <span
                            key={campo}
                            className="relative flex-1 max-w-[18px] rounded-t-[4px]"
                            style={{ height: m[campo] ? Math.max(2, (m[campo] / scala) * ALTEZZA) : 0, background: colore }}
                            aria-hidden="true"
                          >
                            {/* Un numero solo, sul mese più alto: gli altri stanno nel suggerimento e nella tabella. */}
                            {campo === "contatti" && i === picco && m.contatti > 0 && (
                              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-foreground tabular-nums">{n(m.contatti)}</span>
                            )}
                          </span>
                        ))}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* L'anno prima: una linea di riferimento sopra le colonne, che non prende i clic. */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${serie.length} ${ALTEZZA}`} preserveAspectRatio="none" aria-hidden="true">
                <polyline points={punti} fill="none" style={{ stroke: COLORI.riferimento }} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex mt-1.5" aria-hidden="true">
              {/* Da telefono un mese sì e uno no: dodici etichette non ci stanno senza accavallarsi. */}
              {serie.map((m, i) => (
                <span key={m.mese} className={`flex-1 text-center text-[11px] ${meseScelto === m.mese ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  <span className={i % 2 === 1 && meseScelto !== m.mese ? "hidden sm:inline" : ""}>{m.etichetta}</span>
                </span>
              ))}
            </div>
            {elemento}
          </div>
        </div>
      )}
    </Riquadro>
  );
}
