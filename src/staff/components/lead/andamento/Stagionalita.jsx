import React from "react";
import { MESI } from "@/core/domain/lead";
import { useTema } from "@/ui/tema";
import { Riquadro, useSuggerimento, n } from "./comuni";

const GRADINI = 5;

/** Il gradino della scala (0 = niente, 1…5) per un valore. */
const gradino = (v, massimo) => (v <= 0 || massimo <= 0 ? 0 : Math.max(1, Math.ceil((v / massimo) * GRADINI)));

/**
 * Quando arriva ogni canale: canali per riga, mesi dell'anno per colonna, sommando gli anni del
 * periodo. Per una palestra settembre e gennaio non sono mesi come gli altri, e un canale che
 * rende solo in primavera va acceso in primavera. Una scala a un tono solo, dal chiaro allo
 * scuro (al contrario sul tema scuro, dove "di più" è più chiaro); il numero è scritto nella
 * casella, quindi il colore aiuta e basta.
 */
export default function Stagionalita({ matrice }) {
  const { tema } = useTema();
  const { eventi, elemento } = useSuggerimento();
  // Su quali gradini il numero va scritto chiaro: quelli scuri della scala.
  const testoChiaro = (g) => (tema === "scuro" ? g <= 3 : g >= 3);

  return (
    <Riquadro
      titolo="Stagionalità"
      sottotitolo="Contatti per canale e mese dell'anno: colore più intenso, più contatti"
      azioni={(
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground" aria-hidden="true">
          meno
          {Array.from({ length: GRADINI }, (_, i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-[3px]" style={{ background: `var(--viz-scala-${i + 1})` }} />
          ))}
          più
        </div>
      )}
    >
      {matrice.righe.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Nessun contatto nel periodo</p>
      ) : (
        <div className="relative overflow-x-auto" data-grafico>
          <table className="w-full border-separate border-spacing-[2px] text-[11px]">
            <thead>
              <tr>
                <th className="text-left font-medium text-muted-foreground pr-2"><span className="sr-only">Canale</span></th>
                {MESI.map((m) => <th key={m} className="font-medium text-muted-foreground px-0.5" scope="col"><abbr title={m} className="no-underline">{m.slice(0, 3)}</abbr></th>)}
              </tr>
            </thead>
            <tbody>
              {matrice.righe.map((r) => (
                <tr key={r.canale_id}>
                  <th scope="row" className="text-left font-normal text-xs pr-2 w-36 max-w-[9rem] truncate" title={r.nome}>{r.nome}</th>
                  {r.mesi.map((v, i) => {
                    const g = gradino(v, matrice.massimo);
                    return (
                      <td
                        key={i}
                        tabIndex={v > 0 ? 0 : -1}
                        className={`h-7 min-w-[1.75rem] rounded-[4px] text-center tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${g === 0 ? "bg-muted/50 text-muted-foreground/60" : ""}`}
                        style={g ? { background: `var(--viz-scala-${g})`, color: testoChiaro(g) ? "#ffffff" : "#0b0b0b" } : undefined}
                        {...eventi(<p><span className="font-medium">{r.nome}</span>, {MESI[i].toLowerCase()}: {n(v)} contatti</p>)}
                      >
                        {v > 0 ? n(v) : ""}
                        <span className="sr-only">{v === 0 ? `${MESI[i]}: nessun contatto` : ""}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {elemento}
        </div>
      )}
    </Riquadro>
  );
}
