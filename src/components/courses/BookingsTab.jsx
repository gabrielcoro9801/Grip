import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "@/components/shared/StatusBadge";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { cancelBooking } from "@/lib/bookingUtils";
import { formatData } from "@/lib/format";

export default function BookingsTab({ data, reload }) {
  const { bookings, sessions, events, courses } = data;
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const sessionDetails = useMemo(() => {
    const map = new Map();
    sessions.forEach(s => {
      const event = events.find(e => e.id === s.event_id);
      const course = courses.find(c => c.id === event?.course_id);
      map.set(s.id, { session: s, course });
    });
    return map;
  }, [sessions, events, courses]);

  const sorted = useMemo(() => {
    return bookings
      .filter(b => {
        if (!search) return true;
        const details = sessionDetails.get(b.session_id);
        const courseName = details?.course?.name || "";
        return (b.member_name || "").toLowerCase().includes(search.toLowerCase()) || courseName.toLowerCase().includes(search.toLowerCase());
      })
      .sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
  }, [bookings, search, sessionDetails]);

  const handleCancel = async (booking) => {
    try {
      await cancelBooking(booking.id);
      toast({ title: "Prenotazione cancellata" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div><Label className="text-xs">Cerca</Label><Input placeholder="Cliente o corso..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" /></div>
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Corso</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Cliente</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Nessuna prenotazione</td></tr>
            ) : sorted.map(b => {
              const details = sessionDetails.get(b.session_id);
              const session = details?.session;
              return (
                <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4 text-muted-foreground">{session ? formatData(session.date, "giorno") : "—"}</td>
                  <td className="py-3 px-4 font-medium">{details?.course?.name || "—"}</td>
                  <td className="py-3 px-4">{b.member_name}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={b.status} />
                    {b.status === "waitlisted" && b.waitlist_position && <span className="text-xs text-muted-foreground ml-1">#{b.waitlist_position}</span>}
                  </td>
                  <td className="py-3 px-4">
                    {b.status !== "cancelled" && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleCancel(b)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}