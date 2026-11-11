import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/ui/primitivi/button";
import { numeriPagina } from "@/core/domain/paginazione";

/**
 * Il paginatore: «1–12 di 54», Precedente, «Pagina 1 di 5», Successivo. Compare solo oltre una
 * pagina. Basta il totale: l'elenco può averlo tagliato la pagina o contato il server.
 * @param {{ pagina: number, totale: number, perPagina: number, onCambia: (pagina: number) => void, className?: string }} props
 */
export default function Paginazione({ pagina, totale, perPagina, onCambia, className = "" }) {
  const n = numeriPagina(totale, pagina, perPagina);
  if (n.pagine <= 1) return null;
  return (
    <nav aria-label="Pagine" className={`flex flex-wrap items-center justify-between gap-3 mt-4 text-sm ${className}`}>
      <p className="text-muted-foreground tabular-nums">{n.da}–{n.a} di {n.totale}</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={n.pagina <= 1} onClick={() => onCambia(n.pagina - 1)}>
          <ChevronLeft aria-hidden="true" /> Precedente
        </Button>
        <span className="tabular-nums" aria-current="page">Pagina {n.pagina} di {n.pagine}</span>
        <Button type="button" variant="outline" size="sm" disabled={n.pagina >= n.pagine} onClick={() => onCambia(n.pagina + 1)}>
          Successivo <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
