import React from "react";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Clock, MapPin, Users, Pencil, Calendar, UserCog, Repeat } from "lucide-react";
import { getSessionAvailability } from "@/core/domain/bookingUtils";
import { formatData } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";
import { hhmm, eUnaSerie, descriviSerie, lezioniDellaSerie } from "@/staff/lib/modificaEvento";

/**
 * Il riepilogo di una lezione, come si apre cliccandola nel calendario: cosa, quando, dove, chi
 * la tiene, quanti sono iscritti, e se fa parte di una serie. Da qui si passa alla modifica.
 */
export default function RiepilogoLezione({ lezione, data, onClose, onModifica, puoModificare }) {
  const { events, courses, categories, instructors, rooms, sessions, bookings } = data;
  const evento = lezione ? events.find(e => e.id === lezione.event_id) : null;
  const corso = courses.find(c => c.id === evento?.course_id);
  const categoria = categories.find(c => c.id === corso?.category_id);
  const istruttore = instructors.find(i => i.id === corso?.instructor_id);
  const sala = rooms.find(r => r.id === lezione?.room_id);

  return (
    <Dialog open={!!lezione} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        {lezione && (() => {
          const posti = getSessionAvailability(lezione, bookings);
          const serie = evento && eUnaSerie(evento);
          const rimaste = serie ? lezioniDellaSerie(evento, sessions, { oggi: oggiIso() }).length : 0;
          return (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: categoria?.color || "#6b7280" }} aria-hidden="true" />
                  <span className="truncate">{corso?.name || "Lezione"}</span>
                </DialogTitle>
                {categoria && <DialogDescription>{categoria.name}</DialogDescription>}
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="w-4 h-4 shrink-0" /> {formatData(lezione.date, "estesa")}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><Clock className="w-4 h-4 shrink-0" /> {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4 shrink-0" /> {sala?.name || "—"}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><UserCog className="w-4 h-4 shrink-0" /> {istruttore?.full_name || "—"}</div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="w-4 h-4 shrink-0" /> {posti.confirmed}/{posti.capacity} iscritti
                  {posti.waitlisted > 0 && <span className="text-warning">(+{posti.waitlisted} in attesa)</span>}
                </div>
                {serie && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <Repeat className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {descriviSerie(evento)}
                      <span className="block text-xs">{rimaste === 1 ? "1 lezione" : `${rimaste} lezioni`} da oggi in poi</span>
                    </span>
                  </div>
                )}
                {serie && lezione.modified_manually && (
                  <p className="text-xs rounded-lg bg-muted/40 px-3 py-2">Questa lezione è stata modificata a parte rispetto al resto della serie.</p>
                )}
              </div>
              {puoModificare && evento && (
                <Button className="w-full" variant="outline" onClick={() => onModifica(lezione)}>
                  <Pencil className="w-4 h-4 mr-1" /> Modifica
                </Button>
              )}
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
