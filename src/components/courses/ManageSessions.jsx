import React, { useState, useMemo, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Trash2, Pencil, Users, Calendar, ShieldAlert } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { DAYS, DAYS_IT, getDayOfWeekFromDate } from "@/lib/courseValidation";
import { checkSessionConflict } from "@/lib/eventUtils";
import { validateSessionWrite } from "@/lib/sessionValidation";
import { formatData } from "@/lib/format";

const FILTER_OPTIONS = [
  { value: "single", label: "Solo questa sessione" },
  { value: "this_and_next", label: "Questa e le successive" },
  { value: "full_series", label: "Tutta la serie" },
  { value: "by_weekday", label: "Giorno della settimana" },
  { value: "entire_course", label: "Intero corso" },
];

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

export default function ManageSessions({ data, reload, initialSessionId }) {
  const { sessions, events, courses, rooms, bookings } = data;
  const { toast } = useToast();

  const [filterType, setFilterType] = useState("single");
  const [filterSessionId, setFilterSessionId] = useState("");
  const [filterEventId, setFilterEventId] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterDayOfWeek, setFilterDayOfWeek] = useState("Monday");
  const [overrideModified, setOverrideModified] = useState(false);
  const [action, setAction] = useState(null);
  const [editForm, setEditForm] = useState({ start_time: "", end_time: "", room_id: "", capacity: "" });
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialSessionId) {
      setFilterType("single");
      setFilterSessionId(initialSessionId);
    }
  }, [initialSessionId]);

  const courseByEvent = useMemo(() => {
    const map = new Map();
    events.forEach(e => {
      const course = courses.find(c => c.id === e.course_id);
      if (course) map.set(e.id, course);
    });
    return map;
  }, [events, courses]);

  const courseName = (id) => courses.find(c => c.id === id)?.name || "—";
  const eventLabel = (ev) => {
    const name = courseName(ev.course_id);
    if (ev.recurrence_type === "single") return `${name} — ${formatData(ev.start_date)}`;
    if (ev.recurrence_type === "custom") return `${name} — date personalizzate`;
    const days = (ev.days_of_week || []).map(d => (DAYS_IT[d] || d).slice(0, 3)).join(", ");
    return `${name} — ${days} dal ${formatData(ev.start_date)}`;
  };

  // Sessioni attive ordinata per data
  const activeSessions = useMemo(() => 
    sessions.filter(s => s.status === "active").sort((a, b) => a.date.localeCompare(b.date)),
    [sessions]
  );

  // Calcola sessioni matchate dal filtro
  const matchedSessions = useMemo(() => {
    if (filterType === "single") {
      return activeSessions.filter(s => s.id === filterSessionId);
    }
    if (filterType === "this_and_next") {
      return activeSessions.filter(s => s.event_id === filterEventId && s.date >= filterDate);
    }
    if (filterType === "full_series") {
      return activeSessions.filter(s => s.event_id === filterEventId);
    }
    if (filterType === "by_weekday") {
      const courseEventIds = new Set(events.filter(e => e.course_id === filterCourseId).map(e => e.id));
      return activeSessions.filter(s => courseEventIds.has(s.event_id) && getDayOfWeekFromDate(s.date) === filterDayOfWeek);
    }
    if (filterType === "entire_course") {
      const courseEventIds = new Set(events.filter(e => e.course_id === filterCourseId).map(e => e.id));
      return activeSessions.filter(s => courseEventIds.has(s.event_id));
    }
    return [];
  }, [filterType, filterSessionId, filterEventId, filterDate, filterCourseId, filterDayOfWeek, activeSessions, events]);

  // Anteprima d'impatto
  const impact = useMemo(() => {
    const sessionIds = new Set(matchedSessions.map(s => s.id));
    const involvedBookings = bookings.filter(b => sessionIds.has(b.session_id) && b.status !== "cancelled");
    const modifiedManually = matchedSessions.filter(s => s.modified_manually).length;
    return {
      sessionCount: matchedSessions.length,
      bookingCount: involvedBookings.length,
      modifiedManuallyCount: modifiedManually,
    };
  }, [matchedSessions, bookings]);

  // Sessioni target (dopo esclusione modified_manually)
  const targetSessions = useMemo(() => {
    if (overrideModified) return matchedSessions;
    return matchedSessions.filter(s => !s.modified_manually);
  }, [matchedSessions, overrideModified]);

  const excludedCount = impact.sessionCount - targetSessions.length;

  const filterReady = useMemo(() => {
    if (filterType === "single") return !!filterSessionId;
    if (filterType === "this_and_next") return !!filterEventId && !!filterDate;
    if (filterType === "full_series") return !!filterEventId;
    if (filterType === "by_weekday") return !!filterCourseId;
    if (filterType === "entire_course") return !!filterCourseId;
    return false;
  }, [filterType, filterSessionId, filterEventId, filterDate, filterCourseId]);

  // === Azione: Cancella ===
  const handleCancel = async () => {
    if (targetSessions.length === 0) return;
    setSaving(true);
    try {
      await api.entities.Session.bulkUpdate(
        targetSessions.map(s => ({ id: s.id, status: "cancelled" }))
      );

      const sessionIds = new Set(targetSessions.map(s => s.id));
      const sessionBookings = bookings.filter(b => sessionIds.has(b.session_id) && b.status !== "cancelled");
      if (sessionBookings.length > 0) {
        await api.entities.Booking.bulkUpdate(
          sessionBookings.map(b => ({ id: b.id, status: "cancelled" }))
        );
      }

      toast({
        title: "Sessioni cancellate",
        description: `${targetSessions.length} sessioni, ${sessionBookings.length} prenotazioni cancellate` +
          (excludedCount > 0 ? `, ${excludedCount} escluse` : ""),
      });
      setAction(null);
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  // === Azione: Modifica campi ===
  const handleEdit = async () => {
    setSaving(true);
    try {
      const newValues = {};
      if (editForm.start_time) newValues.start_time = editForm.start_time;
      if (editForm.end_time) newValues.end_time = editForm.end_time;
      if (editForm.room_id) newValues.room_id = editForm.room_id;
      if (editForm.capacity) newValues.capacity = Number(editForm.capacity);

      // Per full_series: aggiorna anche l'Event, così le Session rimangono coerenti (modified_manually resta false)
      if (filterType === "full_series" && Object.keys(newValues).length > 0) {
        await api.entities.Event.update(filterEventId, newValues);
      }

      const updated = [];
      const skippedConflict = [];
      const skippedCapacity = [];

      for (const session of targetSessions) {
        const course = courseByEvent.get(session.event_id);

        // Controllo conflitto sala/istruttore
        const conflict = checkSessionConflict(session, newValues, course, sessions, events, courses);
        if (conflict.conflict) {
          skippedConflict.push(conflict.message);
          continue;
        }

        // Controllo capienza
        if (newValues.capacity !== undefined) {
          const confirmedCount = bookings.filter(b => b.session_id === session.id && b.status === "confirmed").length;
          if (newValues.capacity < confirmedCount) {
            skippedCapacity.push(`${formatDate(session.date)}: ${confirmedCount} iscritti confermati, nuova capienza ${newValues.capacity} — modifica saltata`);
            continue;
          }
        }

        // Applica modifica
        const updateData = { ...newValues };
        if (filterType !== "full_series") {
          updateData.modified_manually = true;
        }

        // Barriera strutturale: se modified_manually resta false, i campi devono corrispondere all'Event
        const event = events.find(e => e.id === session.event_id);
        const eventForValidation = filterType === "full_series" ? { ...event, ...newValues } : event;
        const { valid, errors: validationErrors } = validateSessionWrite(updateData, eventForValidation, session);
        if (!valid) {
          throw new Error(`Validazione fallita per sessione ${formatDate(session.date)}: ${validationErrors.join(", ")}`);
        }

        await api.entities.Session.update(session.id, updateData);
        updated.push(formatDate(session.date));
      }

      setResult({
        updated: updated.length,
        updatedDates: updated,
        excluded: excludedCount,
        skippedConflict: skippedConflict.length,
        skippedConflictReasons: skippedConflict,
        skippedCapacity: skippedCapacity.length,
        skippedCapacityReasons: skippedCapacity,
      });

      toast({
        title: "Modifica completata",
        description: `${updated.length} sessioni aggiornate` +
          (skippedConflict.length > 0 ? `, ${skippedConflict.length} saltate per conflitto` : "") +
          (skippedCapacity.length > 0 ? `, ${skippedCapacity.length} saltate per capienza` : ""),
      });
      setAction(null);
      setEditForm({ start_time: "", end_time: "", room_id: "", capacity: "" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
        <ShieldAlert className="w-4 h-4 inline mr-1" />
        Gestione sessioni esistenti: seleziona un filtro, verifica l'impatto, poi scegli l'azione.
      </div>

      {/* Filtro */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div>
            <Label>Tipo di filtro</Label>
            <Select value={filterType} onValueChange={v => {
              setFilterType(v);
              setFilterSessionId(""); setFilterEventId(""); setFilterDate(""); setFilterCourseId("");
              setOverrideModified(false);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filterType === "single" && (
            <div>
              <Label>Sessione</Label>
              <Select value={filterSessionId} onValueChange={setFilterSessionId}>
                <SelectTrigger><SelectValue placeholder="Seleziona sessione" /></SelectTrigger>
                <SelectContent>
                  {activeSessions.map(s => {
                    const course = courseByEvent.get(s.event_id);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {course?.name || "—"} — {formatData(s.date)} {s.start_time}–{s.end_time}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {filterType === "this_and_next" && (
            <>
              <div>
                <Label>Evento</Label>
                <Select value={filterEventId} onValueChange={v => { setFilterEventId(v); setFilterDate(""); }}>
                  <SelectTrigger><SelectValue placeholder="Seleziona evento" /></SelectTrigger>
                  <SelectContent>
                    {events.map(ev => <SelectItem key={ev.id} value={ev.id}>{eventLabel(ev)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {filterEventId && (
                <div>
                  <Label>Dalla data</Label>
                  <Select value={filterDate} onValueChange={setFilterDate}>
                    <SelectTrigger><SelectValue placeholder="Seleziona data di partenza" /></SelectTrigger>
                    <SelectContent>
                      {activeSessions.filter(s => s.event_id === filterEventId).map(s => (
                        <SelectItem key={s.id} value={s.date}>{formatData(s.date)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {filterType === "full_series" && (
            <div>
              <Label>Evento</Label>
              <Select value={filterEventId} onValueChange={setFilterEventId}>
                <SelectTrigger><SelectValue placeholder="Seleziona evento" /></SelectTrigger>
                <SelectContent>
                  {events.map(ev => <SelectItem key={ev.id} value={ev.id}>{eventLabel(ev)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {filterType === "by_weekday" && (
            <>
              <div>
                <Label>Corso</Label>
                <Select value={filterCourseId} onValueChange={setFilterCourseId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona corso" /></SelectTrigger>
                  <SelectContent>
                    {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Giorno della settimana</Label>
                <Select value={filterDayOfWeek} onValueChange={setFilterDayOfWeek}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => <SelectItem key={d} value={d}>{DAYS_IT[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {filterType === "entire_course" && (
            <div>
              <Label>Corso</Label>
              <Select value={filterCourseId} onValueChange={setFilterCourseId}>
                <SelectTrigger><SelectValue placeholder="Seleziona corso" /></SelectTrigger>
                <SelectContent>
                  {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Anteprima d'impatto */}
      {filterReady && impact.sessionCount > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <Calendar className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{impact.sessionCount}</p>
                <p className="text-xs text-muted-foreground">Sessioni matchate</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <Users className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{impact.bookingCount}</p>
                <p className="text-xs text-muted-foreground">Prenotazioni coinvolte</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <Pencil className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                <p className="text-2xl font-bold">{impact.modifiedManuallyCount}</p>
                <p className="text-xs text-muted-foreground">Modificate manualmente</p>
              </div>
            </div>

            {impact.modifiedManuallyCount > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="override"
                    checked={overrideModified}
                    onChange={e => setOverrideModified(e.target.checked)}
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <Label htmlFor="override" className="font-normal cursor-pointer text-sm">
                      {targetSessions.length} sessioni verranno aggiornate, {excludedCount} escluse perché modificate manualmente in precedenza.
                      Includi comunque le {excludedCount} escluse
                    </Label>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="destructive" size="sm" onClick={() => setAction("cancel")} disabled={targetSessions.length === 0}>
                <Trash2 className="w-4 h-4 mr-1" /> Cancella {targetSessions.length} sessioni
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAction("edit")} disabled={targetSessions.length === 0}>
                <Pencil className="w-4 h-4 mr-1" /> Modifica campi
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {filterReady && impact.sessionCount === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">Nessuna sessione attiva trovata per questo filtro.</p>
      )}

      {/* Dialog: conferma cancellazione */}
      <Dialog open={action === "cancel"} onOpenChange={v => { if (!v) setAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Conferma cancellazione</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              Verranno cancellate <strong>{targetSessions.length}</strong> sessioni.
              Tutte le prenotazioni (confirmed + waitlisted) su queste sessioni verranno cancellate.
              Nessun membro verrà promosso dalla lista d'attesa.
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Prenotazioni che verranno cancellate: <strong>{impact.bookingCount}</strong></p>
              {excludedCount > 0 && <p>Sessioni escluse (modificate manualmente): <strong>{excludedCount}</strong></p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAction(null)} disabled={saving}>Annulla</Button>
              <Button variant="destructive" className="flex-1" onClick={handleCancel} disabled={saving}>
                {saving ? "Cancellazione..." : "Conferma cancellazione"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: modifica campi */}
      <Dialog open={action === "edit"} onOpenChange={v => { if (!v) setAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Modifica campi ({targetSessions.length} sessioni)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Lascia vuoto un campo per mantenere il valore attuale di ciascuna sessione.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nuovo inizio</Label><Input type="time" value={editForm.start_time} onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} /></div>
              <div><Label>Nuovo fine</Label><Input type="time" value={editForm.end_time} onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} /></div>
            </div>
            <div>
              <Label>Nuova sala</Label>
              <Select value={editForm.room_id} onValueChange={v => setEditForm({ ...editForm, room_id: v })}>
                <SelectTrigger><SelectValue placeholder="Mantieni attuale" /></SelectTrigger>
                <SelectContent>
                  {rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.capacity} posti)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Nuova capienza</Label><Input type="number" min="0" placeholder="Mantieni attuale" value={editForm.capacity} onChange={e => setEditForm({ ...editForm, capacity: e.target.value })} /></div>

            {filterType !== "full_series" && (
              <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                Le sessioni modificate verranno marcate <code>modified_manually = true</code>.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAction(null)} disabled={saving}>Annulla</Button>
              <Button className="flex-1" onClick={handleEdit} disabled={saving || (!editForm.start_time && !editForm.end_time && !editForm.room_id && !editForm.capacity)}>
                {saving ? "Modifica..." : "Applica modifica"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: riepilogo modifica */}
      <Dialog open={!!result} onOpenChange={v => { if (!v) setResult(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Riepilogo modifica</DialogTitle></DialogHeader>
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-2xl font-bold text-emerald-700">{result.updated}</p>
                  <p className="text-xs text-emerald-600">Sessioni aggiornate</p>
                </div>
                {result.excluded > 0 && (
                  <div className="p-3 rounded-lg bg-muted/40 border">
                    <p className="text-2xl font-bold">{result.excluded}</p>
                    <p className="text-xs text-muted-foreground">Escluse (manuali)</p>
                  </div>
                )}
                {result.skippedConflict > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-2xl font-bold text-amber-700">{result.skippedConflict}</p>
                    <p className="text-xs text-amber-600">Saltate (conflitto)</p>
                  </div>
                )}
                {result.skippedCapacity > 0 && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-2xl font-bold text-red-700">{result.skippedCapacity}</p>
                    <p className="text-xs text-red-600">Saltate (capienza)</p>
                  </div>
                )}
              </div>

              {result.updatedDates.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Date aggiornate: {result.updatedDates.join(", ")}</p>
                </div>
              )}
              {result.skippedConflictReasons.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-700">Saltate per conflitto:</p>
                  {result.skippedConflictReasons.map((r, i) => (
                    <p key={i} className="text-sm text-muted-foreground p-2 rounded bg-muted/40">{r}</p>
                  ))}
                </div>
              )}
              {result.skippedCapacityReasons.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-700">Saltate per capienza insufficiente:</p>
                  {result.skippedCapacityReasons.map((r, i) => (
                    <p key={i} className="text-sm text-muted-foreground p-2 rounded bg-muted/40">{r}</p>
                  ))}
                </div>
              )}

              <Button onClick={() => setResult(null)} className="w-full">Chiudi</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}