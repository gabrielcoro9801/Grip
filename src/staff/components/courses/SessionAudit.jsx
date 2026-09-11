import React, { useMemo } from "react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatData } from "@/core/domain/format";

const FIELDS = [
  { key: "start_time", label: "Inizio" },
  { key: "end_time", label: "Fine" },
  { key: "room_id", label: "Sala" },
  { key: "capacity", label: "Capienza" },
];

export default function SessionAudit({ data }) {
  const { sessions, events, courses, rooms, bookings } = data;

  const suspicious = useMemo(() => {
    const eventMap = new Map(events.map(e => [e.id, e]));
    const courseMap = new Map(courses.map(c => [c.id, c]));
    const roomName = (id) => {
      if (!id) return "—";
      return rooms.find(r => r.id === id)?.name || id;
    };

    return sessions
      .filter(s => s.status === "active" && !s.modified_manually)
      .map(s => {
        const event = eventMap.get(s.event_id);
        if (!event) return null;

        const divergences = [];
        for (const { key, label } of FIELDS) {
          if (s[key] !== event[key]) {
            let actual = s[key];
            let expected = event[key];
            if (key === "room_id") {
              actual = roomName(actual);
              expected = roomName(expected);
            }
            divergences.push({
              field: label,
              expected: String(expected ?? "—"),
              actual: String(actual ?? "—"),
            });
          }
        }

        if (divergences.length === 0) return null;

        const course = courseMap.get(event.course_id);
        const bookingCount = bookings.filter(
          b => b.session_id === s.id && b.status !== "cancelled"
        ).length;

        return {
          sessionId: s.id,
          courseName: course?.name || "—",
          date: formatData(s.date),
          divergences,
          bookingCount,
        };
      })
      .filter(Boolean);
  }, [sessions, events, courses, rooms, bookings]);

  if (suspicious.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-sm text-success flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span><strong>Audit sessioni:</strong> nessuna sessione sospetta. Tutte le sessioni non modificate manualmente corrispondono al proprio Event.</span>
      </div>
    );
  }

  return (
    <Card className="border-warning/30 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-warning">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium">Audit sessioni: {suspicious.length} sessioni sospette</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Queste sessioni hanno <code>modified_manually = false</code> ma campi che divergono dall'Event genitore.
          Nessuna correzione automatica è stata applicata. Rivedi caso per caso.
        </p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {suspicious.map(s => (
            <div key={s.sessionId} className="p-3 rounded-lg bg-warning/10 border border-warning/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{s.courseName} — {s.date}</span>
                <span className="text-xs text-muted-foreground">
                  {s.bookingCount} prenotazion{s.bookingCount === 1 ? "e" : "i"}
                </span>
              </div>
              <div className="space-y-1">
                {s.divergences.map((d, i) => (
                  <div key={i} className="text-xs flex flex-wrap gap-2">
                    <span className="font-medium text-muted-foreground">{d.field}:</span>
                    <span className="text-destructive">attuale: {d.actual}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-success">atteso: {d.expected}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}