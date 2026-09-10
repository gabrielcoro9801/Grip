import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/shared/Spinner";
import { EmptyState, ErrorState } from "@/components/shared/StateViews";
import { cn } from "@/lib/utils";

/**
 * La tabella dell'app.
 *
 * `ui/table.jsx` era installato e importato da zero file, mentre diciannove
 * pagine scrivevano <table> a mano: quattro intestazioni diverse, undici
 * spaziature di <th>, nessuno stato vuoto uniforme e nessuna paginazione
 * (i limiti stavano nei titoli, «Storico (ultimi 10)»).
 *
 * Qui una colonna è { key, header, cell, align, className, headClassName }:
 * `cell(row, index)` rende la cella, altrimenti si legge `row[key]`.
 */

const ALLINEAMENTO = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export default function DataTable({
  columns,
  rows,
  rowKey = (row, i) => row?.id ?? i,
  loading = false,
  error = null,
  onRetry,
  empty,
  emptyTitle = "Nessun risultato",
  emptyDescription,
  pageSize = 0,
  onRowClick,
  footer,
  className,
  caption,
}) {
  const [pagina, setPagina] = useState(0);
  const righe = useMemo(() => rows || [], [rows]);

  const pagine = pageSize > 0 ? Math.max(1, Math.ceil(righe.length / pageSize)) : 1;

  // Se un filtro accorcia la lista, la pagina corrente può non esistere più.
  useEffect(() => {
    if (pagina > pagine - 1) setPagina(0);
  }, [pagina, pagine]);

  const visibili =
    pageSize > 0 ? righe.slice(pagina * pageSize, pagina * pageSize + pageSize) : righe;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!righe.length) {
    return empty ?? <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={cn("w-full", className)}>
      {/* La tabella scorre dentro il proprio riquadro invece di allargare la pagina.
          Senza, su un telefono le colonne uscivano dallo schermo e trascinavano con sé
          tutto il resto: la barra di navigazione finiva fuori posto e la pagina scorreva
          in orizzontale ovunque, non solo qui. */}
      <div className="w-full overflow-x-auto">
      <Table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                scope="col"
                className={cn(
                  "h-auto py-3 px-4 text-xs font-medium uppercase tracking-wide",
                  ALLINEAMENTO[col.align] || ALLINEAMENTO.left,
                  col.headClassName
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibili.map((row, i) => (
            <TableRow
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && "cursor-pointer")}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={cn(
                    "py-3 px-4",
                    ALLINEAMENTO[col.align] || ALLINEAMENTO.left,
                    col.className
                  )}
                >
                  {col.cell ? col.cell(row, i) : row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {footer}
      </Table>
      </div>

      {pagine > 1 && (
        <nav
          aria-label="Paginazione della tabella"
          className="flex items-center justify-between gap-4 px-4 py-3 border-t border-border"
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {righe.length} risultati · pagina {pagina + 1} di {pagine}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(pagine - 1, p + 1))}
              disabled={pagina >= pagine - 1}
            >
              Successiva
              <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
