import React, { useState, useMemo } from "react";
import { Button } from "@/ui/primitivi/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import RiepilogoLezione from "@/staff/components/courses/RiepilogoLezione";
import EliminaEventoDialog from "@/staff/components/courses/EliminaEventoDialog";
import LegendaCorsi from "@/staff/components/courses/LegendaCorsi";
import { grigliaDelMese } from "@/staff/lib/eventUtils";
import { hhmm } from "@/staff/lib/modificaEvento";
import { toIsoDate } from "@/core/domain/format";

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export default function CalendarView({ data, reload }) {
  const { sessions, events, courses, categories, instructors } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  // La lezione di cui si guarda il riepilogo, e quella che si sta modificando.
  const [lezioneAperta, setLezioneAperta] = useState(null);
  const [lezioneInModifica, setLezioneInModifica] = useState(null);
  const [lezioneDaEliminare, setLezioneDaEliminare] = useState(null);
  const [showEventForm, setShowEventForm] = useState(false);
  // La legenda tiene quello che si è *nascosto*: un corso nuovo compare da solo, e il
  // ricaricamento dopo una modifica non rimette in vista quello che si era tolto. Si nasconde per
  // corso; "Tutti/Nessuno" di una categoria agisce sui suoi corsi.
  const [corsiNascosti, setCorsiNascosti] = useState(new Set());

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
      if (meta?.course && corsiNascosti.has(meta.course.id)) return false;
      return true;
    });
  }, [sessions, sessionMeta, corsiNascosti]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    visibleSessions.forEach(s => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    });
    for (const lezioni of map.values()) lezioni.sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
    return map;
  }, [visibleSessions]);

  const monthGrid = useMemo(
    () => grigliaDelMese(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth]
  );

  const monthLabel = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  // Oggi nei campi locali, come le chiavi delle caselle (vedi `grigliaDelMese`).
  const todayStr = toIsoDate(new Date());

  const chiudiModulo = () => { setShowEventForm(false); setLezioneInModifica(null); };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Calendar */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Mese precedente" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="font-heading font-semibold text-lg min-w-[160px] text-center capitalize">{monthLabel}</span>
              <Button variant="outline" size="icon" aria-label="Mese successivo" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <Button size="sm" onClick={() => setShowEventForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo evento</Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DAY_HEADERS.map(d => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map(({ data: date, chiave: dateStr }, i) => {
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
                        <button
                          type="button" key={s.id} onClick={() => setLezioneAperta(s)}
                          className="block w-full text-left text-[10px] sm:text-xs px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity"
                          style={{ background: color + "20", color: color, borderLeft: `3px solid ${color}` }}
                          title={`${meta?.course?.name || ""} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`}
                        >
                          {meta?.course?.name || "—"}
                        </button>
                      );
                    })}
                    {daySessions.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{daySessions.length - 3} altri</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* La legenda dei corsi, che è anche il filtro del calendario. */}
        <div className="lg:w-72 shrink-0 lg:sticky lg:top-4 lg:self-start">
          <LegendaCorsi
            courses={courses} categories={categories} instructors={instructors}
            nascosti={corsiNascosti} onCambia={setCorsiNascosti}
          />
        </div>
      </div>

      <RiepilogoLezione
        lezione={lezioneAperta}
        data={data}
        puoModificare={puoModificare}
        onClose={() => setLezioneAperta(null)}
        onModifica={l => { setLezioneAperta(null); setLezioneInModifica(l); }}
        onElimina={l => { setLezioneAperta(null); setLezioneDaEliminare(l); }}
      />

      <EliminaEventoDialog
        lezione={lezioneDaEliminare}
        data={data}
        onClose={() => setLezioneDaEliminare(null)}
        onEliminato={reload}
      />

      <EventFormDialog
        open={showEventForm || !!lezioneInModifica}
        lezione={lezioneInModifica}
        onClose={chiudiModulo}
        data={data}
        reload={reload}
      />
    </div>
  );
}

