import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";

// I pezzi comuni ai grafici di Andamento: il riquadro, il suggerimento al passaggio del mouse,
// la legenda e il modo di scrivere i numeri. I colori sono variabili CSS (index.css, `--viz-*`):
// ognuno ha un significato fisso in tutta la pagina, e cambia da solo col tema.

export const COLORI = {
  contatti: "var(--viz-contatti)",
  soci: "var(--viz-soci)",
  persi: "var(--viz-persi)",
  inCorso: "var(--viz-in-corso)",
  riferimento: "var(--viz-riferimento)",
};

const numero = new Intl.NumberFormat("it-IT");
export const n = (v) => numero.format(v ?? 0);
export const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

/** Un riquadro con titolo, una riga di spiegazione e, a destra, i comandi (legenda, "Tabella"). */
export function Riquadro({ titolo, sottotitolo, azioni, children, className = "" }) {
  return (
    <Card className={`border-0 shadow-sm ${className}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-heading">{titolo}</CardTitle>
            {sottotitolo && <p className="text-xs text-muted-foreground mt-0.5">{sottotitolo}</p>}
          </div>
          {azioni && <div className="flex flex-wrap items-center gap-3">{azioni}</div>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Un numero in evidenza, con l'etichetta sopra e, sotto, una riga che lo spiega. `dueRighe`
 * riserva due righe all'etichetta: in una fila di riquadri i numeri restano allineati anche
 * quando un'etichetta va a capo.
 */
export function Numero({ etichetta, valore, children, dueRighe = false, className = "" }) {
  return (
    <Card className={`border-0 shadow-sm ${className}`}>
      <CardContent className="p-5 space-y-1">
        <p className={`text-sm text-muted-foreground ${dueRighe ? "min-h-10" : ""}`}>{etichetta}</p>
        <div className="text-3xl font-semibold font-heading">{valore}</div>
        {children}
      </CardContent>
    </Card>
  );
}

/** Le voci della legenda: un segno del colore della serie, e il nome in testo normale. */
export function Legenda({ voci }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {voci.map((v) => (
        <li key={v.etichetta} className="flex items-center gap-1.5">
          {v.linea
            ? <span className="w-4 h-0.5 rounded-full" style={{ background: v.colore }} aria-hidden="true" />
            : <span className="w-2.5 h-2.5 rounded-sm" style={{ background: v.colore }} aria-hidden="true" />}
          {v.etichetta}
        </li>
      ))}
    </ul>
  );
}

/**
 * Il suggerimento al passaggio del mouse o del fuoco da tastiera: arricchisce, non nasconde —
 * ogni numero è leggibile anche altrove (etichette, tabella). `mostra` vuole l'elemento su cui
 * posizionarsi e il contenuto; il contenitore dev'essere `relative`.
 */
export function useSuggerimento() {
  const [stato, setStato] = useState(null);
  const mostra = useCallback((evento, contenuto) => {
    const elemento = evento.currentTarget;
    const contenitore = elemento.closest("[data-grafico]");
    if (!contenitore) return;
    const a = elemento.getBoundingClientRect();
    const c = contenitore.getBoundingClientRect();
    setStato({ x: a.left - c.left + a.width / 2, y: a.top - c.top, contenuto, larghezza: c.width });
  }, []);
  const nascondi = useCallback(() => setStato(null), []);
  const eventi = (contenuto) => ({
    onMouseEnter: (e) => mostra(e, contenuto),
    onFocus: (e) => mostra(e, contenuto),
    onMouseLeave: nascondi,
    onBlur: nascondi,
  });
  const elemento = stato && (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full -mt-2 rounded-lg border border-border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs whitespace-nowrap"
      style={{ left: Math.min(Math.max(stato.x, 80), stato.larghezza - 80), top: stato.y - 6 }}
    >
      {stato.contenuto}
    </div>
  );
  return { eventi, elemento };
}

/** Il pulsante "Tabella / Grafico" dei riquadri che hanno una vista a tabella. */
export function InterruttoreTabella({ tabella, onCambia }) {
  return (
    <button type="button" onClick={() => onCambia(!tabella)} aria-pressed={tabella} className="text-xs font-medium text-primary hover:underline">
      {tabella ? "Mostra grafico" : "Mostra tabella"}
    </button>
  );
}
