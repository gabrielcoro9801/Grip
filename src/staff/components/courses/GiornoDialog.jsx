import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { formatData } from "@/core/domain/format";
import { disponiLezioni, intervalloOre } from "@/staff/lib/vistaGiorno";

const hhmm = (t) => String(t ?? "").slice(0, 5);
// L'altezza di un'ora nella colonna, in pixel: un'ora di lezione tiene nome, orario e sala.
const ORA = 56;
const GRIGIO = "#6b7280";

/**
 * La giornata a ore, come in Google Calendar: si apre dalla casella del giorno o da «+N altri».
 *
 * Ogni lezione è un blocco alto quanto dura; quelle che si sovrappongono si dividono la
 * larghezza (lib/vistaGiorno.js). Un blocco porta alla pagina della lezione. La colonna parte
 * dalle 7, o dalla prima lezione se è prima, e scorre. A schermo stretto la finestra occupa tutto
 * lo schermo.
 *
 * @param giorno   AAAA-MM-GG, o null a finestra chiusa
 * @param lezioni  le lezioni di quel giorno, già filtrate dalla legenda
 * @param rooms    le sale, per il nome
 * @param onNuovaLezione (giorno) => void; senza, il pulsante non c'è
 */
export default function GiornoDialog({ giorno, lezioni, rooms, onClose, onNuovaLezione }) {
  const blocchi = useMemo(() => disponiLezioni(lezioni), [lezioni]);
  const { da, a } = useMemo(() => intervalloOre(lezioni), [lezioni]);
  const ore = Array.from({ length: a - da }, (_, i) => da + i);
  const salaDi = (id) => rooms.find((r) => r.id === id)?.name ?? "—";

  return (
    <Dialog open={!!giorno} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="flex flex-col gap-3 max-w-2xl max-h-[90vh] p-4 sm:p-6 max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
      >
        {giorno && (
          <>
            <DialogHeader className="pr-8 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 gap-2">
              <div className="min-w-0">
                <DialogTitle className="capitalize">{formatData(giorno, "estesa")}</DialogTitle>
                <DialogDescription>
                  {lezioni.length === 0 ? "Nessuna lezione." : lezioni.length === 1 ? "1 lezione" : `${lezioni.length} lezioni`}
                </DialogDescription>
              </div>
              {onNuovaLezione && (
                <Button size="sm" className="self-start sm:self-auto" onClick={() => onNuovaLezione(giorno)}>
                  <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuova lezione
                </Button>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border">
              <div className="relative flex" style={{ height: ore.length * ORA }}>
                {/* La colonna delle ore. */}
                <div className="w-12 shrink-0 border-r border-border" aria-hidden="true">
                  {ore.map((h) => (
                    <div key={h} className="text-[11px] text-muted-foreground tabular-nums text-right pr-1.5 -translate-y-1.5" style={{ height: ORA }}>
                      {h > da ? `${String(h).padStart(2, "0")}:00` : ""}
                    </div>
                  ))}
                </div>
                <div className="relative flex-1 min-w-0">
                  {ore.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * ORA }} aria-hidden="true" />
                  ))}
                  <ol aria-label="Lezioni del giorno">
                    {blocchi.map(({ lezione: l, inizio, fine, colonna, colonne }) => {
                      const colore = l.colore || GRIGIO;
                      const top = ((inizio - da * 60) / 60) * ORA;
                      const altezza = Math.max(((fine - inizio) / 60) * ORA, 22);
                      return (
                        <li
                          key={l.id} className="absolute p-px"
                          style={{ top, height: altezza, left: `${(colonna / colonne) * 100}%`, width: `${100 / colonne}%` }}
                        >
                          <Link
                            to={`/calendario/lezioni/${l.id}`}
                            className="flex h-full flex-col overflow-hidden rounded-md px-1.5 py-1 text-xs leading-tight hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{ background: `${colore}22`, color: colore, borderLeft: `3px solid ${colore}` }}
                          >
                            <span className="font-semibold truncate">{l.corso}</span>
                            <span className="flex flex-wrap gap-x-1.5 text-foreground/80">
                              <span className="tabular-nums whitespace-nowrap">{hhmm(l.start_time)}–{hhmm(l.end_time)}</span>
                              <span className="truncate">{salaDi(l.room_id)}</span>
                              <span className="tabular-nums whitespace-nowrap">{l.confermati}/{l.capacity} posti</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
