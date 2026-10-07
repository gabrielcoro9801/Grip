import React from "react";
import { COLORI, Legenda, Riquadro, useSuggerimento, n, pct } from "./comuni";

const SEGMENTI = [
  { campo: "socio", etichetta: "Diventati soci", colore: COLORI.soci },
  { campo: "aperto", etichetta: "In corso", colore: COLORI.inCorso },
  { campo: "perso", etichetta: "Persi", colore: COLORI.persi },
];

/**
 * Canale per canale: quanti contatti porta e come sono finiti. La lunghezza della barra è il
 * numero dei contatti; le sue parti dicono quanti sono diventati soci, quanti sono ancora in
 * corso e quanti si sono persi. È la domanda che conta: non chi porta più telefonate, ma chi
 * porta più iscritti. Un clic sul nome filtra la pagina su quel canale.
 */
export default function EsitiCanali({ canali, canaleScelto, onScegliCanale }) {
  const { eventi, elemento } = useSuggerimento();
  const massimo = Math.max(1, ...canali.map((c) => c.contatti));
  return (
    <Riquadro
      titolo="Canali: chi porta soci"
      sottotitolo="La barra è lunga quanto i contatti; le parti dicono come sono finiti"
      azioni={<Legenda voci={SEGMENTI.map((s) => ({ etichetta: s.etichetta, colore: s.colore }))} />}
    >
      {canali.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Nessun contatto nel periodo</p>
      ) : (
        <ul className="relative space-y-2.5" data-grafico>
          {canali.map((c) => {
            const spento = canaleScelto && canaleScelto !== c.canale_id;
            return (
              // Da telefono nome e numeri stanno su una riga e la barra sotto, a tutta larghezza:
              // in tre colonne la barra restava di pochi pixel.
              <li key={c.canale_id} className={`grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 gap-y-1 transition-opacity ${spento ? "opacity-40" : ""}`}>
                <button
                  type="button" onClick={() => onScegliCanale(canaleScelto === c.canale_id ? null : c.canale_id)}
                  aria-pressed={canaleScelto === c.canale_id}
                  className="text-sm text-left truncate hover:text-primary hover:underline"
                  title={c.nome}
                >
                  {c.nome}
                </button>
                <div className="h-5 flex gap-[2px] order-3 col-span-2 sm:order-none sm:col-span-1" style={{ width: `${(c.contatti / massimo) * 100}%` }}>
                  {SEGMENTI.filter((s) => c[s.campo] > 0).map((s, i, visibili) => (
                    <span
                      key={s.campo}
                      tabIndex={0}
                      role="img"
                      aria-label={`${c.nome}: ${c[s.campo]} ${s.etichetta.toLowerCase()} su ${c.contatti}`}
                      className={`h-full min-w-[3px] ${i === 0 ? "rounded-l-[4px]" : ""} ${i === visibili.length - 1 ? "rounded-r-[4px]" : ""} focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
                      style={{ flexGrow: c[s.campo], flexBasis: 0, background: s.colore }}
                      {...eventi(
                        <div className="space-y-0.5">
                          <p className="font-medium">{c.nome}</p>
                          <p>{s.etichetta}: {n(c[s.campo])} su {n(c.contatti)} ({pct(c[s.campo] / c.contatti)})</p>
                        </div>,
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground whitespace-nowrap text-right order-2 sm:order-none">
                  <span className="font-medium text-foreground tabular-nums">{n(c.contatti)}</span> · {pct(c.tasso)} soci
                </p>
              </li>
            );
          })}
          {elemento}
        </ul>
      )}
    </Riquadro>
  );
}
