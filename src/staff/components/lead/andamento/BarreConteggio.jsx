import React from "react";
import { Riquadro, useSuggerimento, n, pct } from "./comuni";

/**
 * Barre orizzontali di una serie sola, un colore solo: il colore dice *che cosa* si conta
 * (contatti in blu, persi in arancio), non quanto. Il numero è scritto in fondo a ogni barra.
 * Se `onScegli` c'è, ogni voce è un filtro per la pagina.
 *
 * @param voci [{ chiave, etichetta, totale }]
 */
export default function BarreConteggio({ titolo, sottotitolo, voci, colore, scelta, onScegli, vuoto = "Nessun dato nel periodo" }) {
  const { eventi, elemento } = useSuggerimento();
  const totale = voci.reduce((s, v) => s + v.totale, 0);
  const massimo = Math.max(1, ...voci.map((v) => v.totale));
  return (
    <Riquadro titolo={titolo} sottotitolo={sottotitolo}>
      {totale === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{vuoto}</p>
      ) : (
        <ul className="relative space-y-2" data-grafico>
          {voci.map((v) => {
            const scelta_ = scelta === v.chiave;
            const spento = scelta && !scelta_;
            const contenuto = (
              <>
                <span className="text-sm truncate text-left">{v.etichetta}</span>
                <span className="h-4 flex items-center">
                  {v.totale > 0 && (
                    <span className="h-full rounded-r-[4px] min-w-[3px]" style={{ width: `${(v.totale / massimo) * 100}%`, background: colore }} aria-hidden="true" />
                  )}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap text-right">
                  <span className="font-medium text-foreground tabular-nums">{n(v.totale)}</span> · {pct(v.totale / totale)}
                </span>
              </>
            );
            const classi = `w-full grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 rounded-md transition-opacity ${spento ? "opacity-40" : ""}`;
            const suggerimento = eventi(<p><span className="font-medium">{v.etichetta}</span>: {n(v.totale)} su {n(totale)} ({pct(v.totale / totale)})</p>);
            return (
              <li key={v.chiave}>
                {onScegli ? (
                  <button
                    type="button" onClick={() => onScegli(scelta_ ? null : v.chiave)} aria-pressed={scelta_}
                    className={`${classi} hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
                    {...suggerimento}
                  >
                    {contenuto}
                  </button>
                ) : (
                  <div className={classi} tabIndex={0} {...suggerimento}>{contenuto}</div>
                )}
              </li>
            );
          })}
          {elemento}
        </ul>
      )}
    </Riquadro>
  );
}
