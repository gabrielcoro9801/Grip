import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import moment from "moment";
import CourseSessionCard from "@/components/member/CourseSessionCard";
import { getSessionAvailability, getMemberBooking } from "@/lib/bookingUtils";

export default function CoursesByCalendar({ enrichedSessions, bookings, memberUser, onBook, onCancel, actionLoading }) {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    const dow = today.getDay();
    const offset = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(monday.getDate() - offset);
    monday.setHours(0, 0, 0, 0);
    return monday;
  });
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const weekRangeLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    if (start.getMonth() === end.getMonth()) {
      return `${moment(start).format("D")}–${moment(end).format("D MMMM")}`;
    }
    return `${moment(start).format("D MMMM")}–${moment(end).format("D MMMM")}`;
  }, [weekDays]);

  const daySessions = useMemo(() => {
    return enrichedSessions
      .filter(s => s.date === selectedDate && s.status === "active")
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [enrichedSessions, selectedDate]);

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={prevWeek}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="font-heading font-semibold text-sm capitalize">{weekRangeLabel}</span>
        <Button variant="outline" size="icon" onClick={nextWeek}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map(d => {
          const dateStr = d.toISOString().split("T")[0];
          const isSelected = dateStr === selectedDate;
          const sess = enrichedSessions.filter(s => s.date === dateStr && s.status === "active");
          const cats = new Map();
          sess.forEach(s => {
            if (s._category && !cats.has(s._category.id)) cats.set(s._category.id, s._category);
          });
          const catList = Array.from(cats.values()).slice(0, 3);
          return (
            <button key={dateStr} onClick={() => setSelectedDate(dateStr)}
              className={`py-2 rounded-lg text-center transition-colors ${isSelected ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:border-primary"}`}>
              <p className="text-[10px] uppercase">{moment(d).format("ddd")}</p>
              <p className="text-lg font-bold">{moment(d).format("D")}</p>
              <div className="flex justify-center gap-0.5 mt-1 h-2">
                {catList.map(c => <div key={c.id} className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="font-heading font-semibold capitalize">{moment(selectedDate).format("dddd D MMMM")}</h2>
        {daySessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun corso programmato per questa data</p>
        ) : (
          daySessions.map(session => {
            const info = getSessionAvailability(session, bookings);
            const memberBooking = getMemberBooking(session.id, memberUser.member_id, bookings);
            return (
              <CourseSessionCard
                key={session.id}
                session={session}
                available={info.available}
                capacity={info.capacity}
                memberBooking={memberBooking}
                onBook={() => onBook(session)}
                onCancel={() => onCancel(memberBooking.id)}
                actionLoading={actionLoading}
              />
            );
          })
        )}
      </div>
    </div>
  );
}