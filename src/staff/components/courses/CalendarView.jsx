import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Card, CardContent } from "@/ui/primitivi/card";
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, Pencil, Calendar } from "lucide-react";
import { getSessionAvailability } from "@/core/domain/bookingUtils";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import ManageSessions from "@/staff/components/courses/ManageSessions";
import SessionAudit from "@/staff/components/courses/SessionAudit";
import { formatData } from "@/core/domain/format";

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export default function CalendarView({ data, reload }) {
  const { sessions, events, courses, categories, rooms, bookings } = data;
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedSession, setSelectedSession] = useState(null);
  const [visibleCategories, setVisibleCategories] = useState(new Set());
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [showEventForm, setShowEventForm] = useState(false);
  const [manageSessionId, setManageSessionId] = useState(null);

  useEffect(() => {
    setVisibleCategories(new Set(categories.map(c => c.id)));
  }, [categories]);

  const sessionMeta = useMemo(() => {
    const map = new Map();
    sessions.forEach(s => {
      const event = events.find(e => e.id === s.event_id);
      const course = courses.find(c => c.id === event?.course_id);
      const category = categories.find(cat => cat.id === course?.category_id);
      map.set(s.id, { event, course, category });
    });
    return map;
  }, [sessions, events, courses, categories]);

  const visibleSessions = useMemo(() => {
    return sessions.filter(s => {
      if (s.status !== "active") return false;
      const meta = sessionMeta.get(s.id);
      if (!meta?.category) return true;
      return visibleCategories.has(meta.category.id);
    });
  }, [sessions, sessionMeta, visibleCategories]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    visibleSessions.forEach(s => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    });
    return map;
  }, [visibleSessions]);

  const monthGrid = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const dow = firstDay.getDay();
    const offset = dow === 0 ? 6 : dow - 1;
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - offset);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentMonth]);

  const monthLabel = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  const todayStr = new Date().toISOString().split("T")[0];
  const roomName = (id) => rooms.find(r => r.id === id)?.name || "—";

  const toggleCategory = (catId) => {
    setVisibleCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  const toggleExpand = (catId) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <SessionAudit data={data} />

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Calendar */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="font-heading font-semibold text-lg min-w-[160px] text-center capitalize">{monthLabel}</span>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <Button size="sm" onClick={() => setShowEventForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo evento</Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DAY_HEADERS.map(d => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((date, i) => {
              const dateStr = date.toISOString().split("T")[0];
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
              const isToday = dateStr === todayStr;
              const daySessions = sessionsByDate.get(dateStr) || [];
              return (
                <div key={i} className={`min-h-[70px] sm:min-h-[90px] p-1 rounded-lg border ${isCurrentMonth ? "bg-card" : "bg-muted/20"} ${isToday ? "border-primary" : "border-border/50"} ${!isCurrentMonth ? "opacity-40" : ""}`}>
                  <div className={`text-xs mb-1 ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{date.getDate()}</div>
                  <div className="space-y-0.5">
                    {daySessions.slice(0, 3).map(s => {
                      const meta = sessionMeta.get(s.id);
                      const color = meta?.category?.color || "#6b7280";
                      return (
                        <div key={s.id} onClick={() => setSelectedSession(s)} className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity" style={{ background: color + "20", color: color, borderLeft: `3px solid ${color}` }} title={`${meta?.course?.name || ""} ${s.start_time}–${s.end_time}`}>
                          {meta?.course?.name || "—"}
                        </div>
                      );
                    })}
                    {daySessions.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{daySessions.length - 3} altri</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Categories panel */}
        <div className="lg:w-56 shrink-0">
          <Card className="border-0 shadow-sm lg:sticky lg:top-4">
            <CardContent className="p-3 space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Categorie</h4>
              {categories.map(cat => (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/40">
                    <input type="checkbox" checked={visibleCategories.has(cat.id)} onChange={() => toggleCategory(cat.id)} className="accent-primary w-4 h-4" />
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color || "#ccc" }} />
                    <button onClick={() => toggleExpand(cat.id)} className="text-sm flex-1 text-left truncate">{cat.name}</button>
                  </div>
                  {expandedCategories.has(cat.id) && (
                    <div className="ml-8 space-y-0.5">
                      {courses.filter(c => c.category_id === cat.id).map(c => <div key={c.id} className="text-xs text-muted-foreground py-0.5 truncate">• {c.name}</div>)}
                      {courses.filter(c => c.category_id === cat.id).length === 0 && <div className="text-xs text-muted-foreground/50 py-0.5">Nessun corso</div>}
                    </div>
                  )}
                </div>
              ))}
              {categories.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nessuna categoria</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Session detail */}
      <Dialog open={!!selectedSession} onOpenChange={v => { if (!v) setSelectedSession(null); }}>
        <DialogContent className="max-w-sm">
          {selectedSession && (() => {
            const meta = sessionMeta.get(selectedSession.id);
            const info = getSessionAvailability(selectedSession, bookings);
            return (
              <>
                <DialogHeader><DialogTitle>{meta?.course?.name || "Sessione"}</DialogTitle></DialogHeader>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="w-4 h-4" /> {formatData(selectedSession.date, "estesa")}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Clock className="w-4 h-4" /> {selectedSession.start_time}–{selectedSession.end_time}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4" /> {roomName(selectedSession.room_id)}</div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Users className="w-4 h-4" /> {info.confirmed}/{info.capacity} iscritti {info.waitlisted > 0 && <span className="text-warning">(+{info.waitlisted} attesa)</span>}</div>
                </div>
                <Button className="w-full" variant="outline" onClick={() => { setManageSessionId(selectedSession.id); setSelectedSession(null); }}>
                  <Pencil className="w-4 h-4 mr-1" /> Modifica sessione
                </Button>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <EventFormDialog open={showEventForm} onClose={() => setShowEventForm(false)} data={data} reload={reload} />

      <Dialog open={!!manageSessionId} onOpenChange={v => { if (!v) setManageSessionId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Gestione sessione</DialogTitle></DialogHeader>
          {manageSessionId && <ManageSessions data={data} reload={reload} initialSessionId={manageSessionId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}