import React, { useState, useMemo } from "react";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import RiepilogoLezione from "@/staff/components/courses/RiepilogoLezione";
import { grigliaDelMese } from "@/staff/lib/eventUtils";
import { hhmm } from "@/staff/lib/modificaEvento";
import { toIsoDate } from "@/core/domain/format";

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

const alterna = (insieme, id) => {
  const next = new Set(insieme);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};

export default function CalendarView({ data, reload }) {
  const { sessions, events, courses, categories, instructors } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  // La lezione di cui si guarda il riepilogo, e quella che si sta modificando.
  const [lezioneAperta, setLezioneAperta] = useState(null);
  const [lezioneInModifica, setLezioneInModifica] = useState(null);
  const [showEventForm, setShowEventForm] = useState(false);
  // I filtri tengono quello che si è *nascosto*: una categoria o un corso nuovi compaiono da
  // soli, e il ricaricamento dopo una modifica non rimette in vista quello che si era tolto.
  const [categorieNascoste, setCategorieNascoste] = useState(new Set());
  const [corsiNascosti, setCorsiNascosti] = useState(new Set());
  const [categorieAperte, setCategorieAperte] = useState(new Set());
  const [corsiAperti, setCorsiAperti] = useState(new Set());

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
      if (meta?.category && categorieNascoste.has(meta.category.id)) return false;
      if (meta?.course && corsiNascosti.has(meta.course.id)) return false;
      return true;
    });
  }, [sessions, sessionMeta, categorieNascoste, corsiNascosti]);

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

  const corsiInOrdine = useMemo(
    () => [...courses].sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" })),
    [courses]
  );

  const monthLabel = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  // Oggi nei campi locali, come le chiavi delle caselle (vedi `grigliaDelMese`).
  const todayStr = toIsoDate(new Date());
  const categoria = (id) => categories.find(c => c.id === id);
  const nomeIstruttore = (id) => instructors.find(i => i.id === id)?.full_name || "—";

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

        {/* Filtri: le categorie, e subito sotto i corsi, fatti allo stesso modo. */}
        <div className="lg:w-56 shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <PannelloFiltro
            titolo="Categorie"
            vuoto="Nessuna categoria"
            voci={categories.map(cat => ({
              id: cat.id, nome: cat.name, colore: cat.color,
              dettagli: courses.filter(c => c.category_id === cat.id).map(c => c.name),
              senzaDettagli: "Nessun corso",
            }))}
            nascoste={categorieNascoste}
            onAlterna={id => setCategorieNascoste(prev => alterna(prev, id))}
            aperte={categorieAperte}
            onApri={id => setCategorieAperte(prev => alterna(prev, id))}
          />
          <PannelloFiltro
            titolo="Corsi"
            vuoto="Nessun corso"
            voci={corsiInOrdine.map(c => ({
              id: c.id, nome: c.name, colore: categoria(c.category_id)?.color,
              dettagli: [`Categoria: ${categoria(c.category_id)?.name || "—"}`, `Istruttore: ${nomeIstruttore(c.instructor_id)}`],
            }))}
            nascoste={corsiNascosti}
            onAlterna={id => setCorsiNascosti(prev => alterna(prev, id))}
            aperte={corsiAperti}
            onApri={id => setCorsiAperti(prev => alterna(prev, id))}
          />
        </div>
      </div>

      <RiepilogoLezione
        lezione={lezioneAperta}
        data={data}
        puoModificare={puoModificare}
        onClose={() => setLezioneAperta(null)}
        onModifica={l => { setLezioneAperta(null); setLezioneInModifica(l); }}
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

/** Un elenco di voci da mostrare o nascondere nel calendario; il nome apre i dettagli. */
function PannelloFiltro({ titolo, vuoto, voci, nascoste, onAlterna, aperte, onApri }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-3 space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{titolo}</h4>
        {voci.map(v => (
          <div key={v.id}>
            <div className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/40">
              <input type="checkbox" checked={!nascoste.has(v.id)} onChange={() => onAlterna(v.id)} aria-label={`Mostra ${v.nome}`} className="accent-primary w-4 h-4" />
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: v.colore || "#ccc" }} />
              <button type="button" onClick={() => onApri(v.id)} aria-expanded={aperte.has(v.id)} className="text-sm flex-1 text-left truncate">{v.nome}</button>
            </div>
            {aperte.has(v.id) && (
              <div className="ml-8 space-y-0.5">
                {v.dettagli.map((d, i) => <div key={i} className="text-xs text-muted-foreground py-0.5 truncate">• {d}</div>)}
                {v.dettagli.length === 0 && <div className="text-xs text-muted-foreground/50 py-0.5">{v.senzaDettagli}</div>}
              </div>
            )}
          </div>
        ))}
        {voci.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{vuoto}</p>}
      </CardContent>
    </Card>
  );
}
