import React from "react";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Clock, User, MapPin } from "lucide-react";
import { formatData } from "@/core/domain/format";

export default function CourseSessionCard({
  session,
  available,
  capacity,
  memberBooking,
  onBook,
  onCancel,
  actionLoading,
}) {
  const isFull = available <= 0;
  const course = session._course;
  const room = session._room;
  const instructor = session._instructor;
  const category = session._category;

  return (
    <div className="p-3 rounded-lg bg-muted/50 space-y-2" style={{ borderLeft: `4px solid ${category?.color || "transparent"}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{course?.name}</p>
          <p className="text-xs text-muted-foreground">{formatData(session.date, "giorno")}</p>
        </div>
        {memberBooking ? (
          <Badge variant="outline" className={`text-xs flex-shrink-0 ${memberBooking.status === "confirmed" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}>
            {memberBooking.status === "confirmed" ? "Prenotato" : `Lista #${memberBooking.waitlist_position}`}
          </Badge>
        ) : isFull ? (
          <Badge variant="outline" className="text-xs flex-shrink-0 bg-destructive/10 text-destructive border-destructive/30">Completo</Badge>
        ) : (
          <Badge variant="outline" className="text-xs flex-shrink-0 bg-success/10 text-success border-success/30">{available} di {capacity} posti</Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {session.start_time}{session.end_time ? `–${session.end_time}` : ""}
        </span>
        {room && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {room.name}</span>}
        {instructor?.full_name && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {instructor.full_name}</span>}
      </div>
      <div className="flex gap-2">
        {!memberBooking && !isFull && <Button size="sm" className="w-full" onClick={onBook} disabled={actionLoading}>Prenota</Button>}
        {!memberBooking && isFull && <Button size="sm" variant="outline" className="w-full" onClick={onBook} disabled={actionLoading}>Entra in lista d'attesa</Button>}
        {memberBooking && <Button size="sm" variant="outline" className="w-full" onClick={onCancel} disabled={actionLoading}>Annulla</Button>}
      </div>
    </div>
  );
}