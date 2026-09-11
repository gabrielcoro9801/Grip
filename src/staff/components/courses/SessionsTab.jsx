import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { UserPlus, Clock, MapPin, Calendar, Users } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { createBooking, getSessionAvailability } from "@/core/domain/bookingUtils";
import { formatData } from "@/core/domain/format";

export default function SessionsTab({ data, reload }) {
  const { courses, events, sessions, rooms, members, bookings } = data;
  const { toast } = useToast();
  const [dateFilter, setDateFilter] = useState("");
  const [bookSession, setBookSession] = useState(null);
  const [memberId, setMemberId] = useState("");
  const [saving, setSaving] = useState(false);

  const courseByEvent = useMemo(() => {
    const map = new Map();
    events.forEach(e => {
      const course = courses.find(c => c.id === e.course_id);
      if (course) map.set(e.id, course);
    });
    return map;
  }, [events, courses]);

  const roomName = (id) => rooms.find(r => r.id === id)?.name || "—";

  const sortedSessions = useMemo(() => {
    return sessions
      .filter(s => s.status === "active")
      .filter(s => !dateFilter || s.date === dateFilter)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
  }, [sessions, dateFilter]);

  const handleBook = async (e) => {
    e.preventDefault();
    if (!bookSession || !memberId) return;
    setSaving(true);
    try {
      const member = members.find(m => m.id === memberId);
      const result = await createBooking(bookSession, memberId);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Prenotazione bloccata", description: result.error });
      } else if (result.status === "confirmed") {
        toast({ title: "Prenotazione confermata", description: member?.full_name });
      } else {
        toast({ title: "In lista d'attesa", description: `Posizione #${result.waitlist_position}` });
      }
      setBookSession(null);
      setMemberId("");
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div><Label className="text-xs">Filtra per data</Label><Input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="w-44" /></div>
        {dateFilter && <Button variant="ghost" size="sm" onClick={() => setDateFilter("")}>Pulisci</Button>}
      </div>

      {sortedSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessuna sessione{dateFilter ? " per questa data" : ""}. Crea un evento per generare sessioni.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedSessions.map(session => {
            const course = courseByEvent.get(session.event_id);
            const info = getSessionAvailability(session, bookings);
            return (
              <Card key={session.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <h4 className="font-medium text-sm mb-2">{course?.name || "Corso"}</h4>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatData(session.date, "giorno")}</div>
                    <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {session.start_time}–{session.end_time}</div>
                    <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {roomName(session.room_id)}</div>
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      <span className={info.isFull ? "text-destructive font-medium" : ""}>{info.confirmed}/{info.capacity} posti</span>
                      {info.waitlisted > 0 && <span className="text-warning">(+{info.waitlisted} attesa)</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="w-full mt-3 text-xs h-7" onClick={() => { setBookSession(session); setMemberId(""); }}>
                    <UserPlus className="w-3 h-3 mr-1" /> Prenota cliente
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog: prenota cliente */}
      <Dialog open={!!bookSession} onOpenChange={v => { if (!v) setBookSession(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Prenota cliente</DialogTitle></DialogHeader>
          <form onSubmit={handleBook} className="space-y-3">
            {bookSession && (() => {
              const course = courseByEvent.get(bookSession.event_id);
              const info = getSessionAvailability(bookSession, bookings);
              return (
                <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                  <div className="font-medium">{course?.name}</div>
                  <div className="text-xs text-muted-foreground">{formatData(bookSession.date, "estesaBreve")} — {bookSession.start_time}–{bookSession.end_time}</div>
                  {info.isFull ? (
                    <p className="text-sm text-warning mt-1">Completo ({info.confirmed}/{info.capacity}). La prenotazione andrà in lista d'attesa (posizione #{info.waitlisted + 1}).</p>
                  ) : (
                    <p className="text-sm text-success mt-1">Posti residui: {info.available} su {info.capacity}</p>
                  )}
                </div>
              );
            })()}
            <div>
              <Label>Cliente *</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
                <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={saving || !memberId}>
              {saving ? "Prenotazione..." : "Conferma prenotazione"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}