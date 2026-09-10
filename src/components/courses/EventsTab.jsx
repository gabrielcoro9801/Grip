import React, { useState, useMemo } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Calendar, AlertTriangle, Clock, MapPin, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DAYS, DAYS_IT } from "@/lib/courseValidation";
import { generateSessionDates, checkEventConflicts } from "@/lib/eventUtils";
import { validateSessionsBulk } from "@/lib/sessionValidation";
import { formatData } from "@/lib/format";

const MAX_SESSIONS = 104;

export default function EventsTab({ data, reload }) {
  const { courses, events, sessions, rooms } = data;
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [generationResult, setGenerationResult] = useState(null);
  const [customDateInput, setCustomDateInput] = useState("");
  const [form, setForm] = useState({
    course_id: "", room_id: "", capacity: "",
    recurrence_type: "single", days_of_week: [],
    start_date: new Date().toISOString().split("T")[0],
    end_condition: "by_date", end_date: "", occurrence_count: "",
    start_time: "09:00", end_time: "10:00",
    custom_dates: [],
  });

  // Anteprima conteggio sessioni in tempo reale
  const previewCount = useMemo(() => {
    if (!form.start_date && form.recurrence_type !== "custom") return 0;
    if (form.recurrence_type === "weekly" && form.days_of_week.length === 0) return 0;
    if (form.recurrence_type === "custom") return form.custom_dates.length;
    try {
      return generateSessionDates({
        recurrence_type: form.recurrence_type,
        start_date: form.start_date,
        days_of_week: form.days_of_week,
        end_condition: form.end_condition,
        end_date: form.end_date,
        occurrence_count: form.occurrence_count,
        custom_dates: form.custom_dates,
      }).length;
    } catch {
      return 0;
    }
  }, [form]);

  const overLimit = previewCount > MAX_SESSIONS;

  const openForm = () => {
    setError("");
    setGenerationResult(null);
    setForm({
      course_id: "", room_id: "", capacity: "",
      recurrence_type: "single", days_of_week: [],
      start_date: new Date().toISOString().split("T")[0],
      end_condition: "by_date", end_date: "", occurrence_count: "",
      start_time: "09:00", end_time: "10:00",
      custom_dates: [],
    });
    setCustomDateInput("");
    setShowForm(true);
  };

  const toggleDay = (day) => {
    setForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day],
    }));
  };

  const addCustomDate = () => {
    if (!customDateInput || form.custom_dates.includes(customDateInput)) return;
    setForm(prev => ({ ...prev, custom_dates: [...prev.custom_dates, customDateInput].sort() }));
    setCustomDateInput("");
  };

  const removeCustomDate = (date) => {
    setForm(prev => ({ ...prev, custom_dates: prev.custom_dates.filter(d => d !== date) }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    setGenerationResult(null);

    if (!form.course_id || !form.room_id || !form.start_time || !form.end_time) return;
    if (form.start_time >= form.end_time) {
      setError("L'orario di inizio deve precedere quello di fine.");
      return;
    }

    if (form.recurrence_type === "weekly") {
      if (form.days_of_week.length === 0) { setError("Seleziona almeno un giorno della settimana."); return; }
      if (form.end_condition === "by_date" && !form.end_date) { setError("La data di fine è obbligatoria."); return; }
      if (form.end_condition === "by_date" && form.end_date < form.start_date) { setError("La data di fine non può precedere quella di inizio."); return; }
      if (form.end_condition === "by_count" && (!form.occurrence_count || Number(form.occurrence_count) <= 0)) {
        setError("Il numero di occorrenze è obbligatorio."); return;
      }
    }

    if (form.recurrence_type === "custom" && form.custom_dates.length === 0) {
      setError("Aggiungi almeno una data personalizzata."); return;
    }

    setSaving(true);
    try {
      const course = courses.find(c => c.id === form.course_id);
      const room = rooms.find(r => r.id === form.room_id);

      const eventData = {
        course_id: form.course_id,
        room_id: form.room_id,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        recurrence_type: form.recurrence_type,
        days_of_week: form.recurrence_type === "weekly" ? form.days_of_week : undefined,
        start_date: form.start_date,
        end_condition: form.recurrence_type === "weekly" ? form.end_condition : undefined,
        end_date: form.recurrence_type === "weekly" && form.end_condition === "by_date" ? form.end_date : undefined,
        occurrence_count: form.recurrence_type === "weekly" && form.end_condition === "by_count" ? Number(form.occurrence_count) : undefined,
        custom_dates: form.recurrence_type === "custom" ? form.custom_dates : undefined,
        start_time: form.start_time,
        end_time: form.end_time,
      };

      const dates = generateSessionDates(eventData);

      // Guardrail anti-serie-infinita
      if (dates.length > MAX_SESSIONS) {
        setError(`Questo pattern genera ${dates.length} sessioni, il massimo consentito in una sola creazione è ${MAX_SESSIONS}. Riduci l'intervallo di date o il numero di occorrenze.`);
        setSaving(false);
        return;
      }

      if (dates.length === 0) {
        setError("Nessuna data generata. Controlla i parametri di ricorrenza.");
        setSaving(false);
        return;
      }

      // Controllo conflitti per ogni data
      const { conflicts, cleanDates } = checkEventConflicts(dates, eventData, course, sessions, events, courses);

      // Se tutte le date sono in conflitto, non creare l'Event
      if (cleanDates.length === 0) {
        setError(`Tutte le ${conflicts.length} date sono in conflitto. Event non creato.\n${conflicts.map(c => c.message).join("\n")}`);
        setSaving(false);
        return;
      }

      // Capacity sempre concreta sull'Event: le Session la ereditano identica (invariante modified_manually=false)
      const capacity = eventData.capacity || room?.capacity || 0;
      eventData.capacity = capacity;

      // Crea Event
      const createdEvent = await api.entities.Event.create(eventData);
      const sessionRecords = cleanDates.map(date => ({
        event_id: createdEvent.id,
        date,
        start_time: eventData.start_time,
        end_time: eventData.end_time,
        room_id: eventData.room_id,
        capacity: eventData.capacity,
        status: "active",
        modified_manually: false,
      }));
      // Barriera strutturale: le sessioni auto-generate devono essere identiche all'Event
      const { valid, errors: validationErrors } = validateSessionsBulk(sessionRecords, eventData);
      if (!valid) {
        throw new Error(`Validazione sessioni fallita — divergenza dall'Event:\n${validationErrors.join("\n")}`);
      }
      await api.entities.Session.bulkCreate(sessionRecords);

      // Riepilogo
      toast({
        title: "Evento creato",
        description: conflicts.length > 0
          ? `${cleanDates.length} sessioni create, ${conflicts.length} saltate per conflitti`
          : `${cleanDates.length} sessioni generate`,
      });

      if (conflicts.length > 0) {
        setGenerationResult({
          created: cleanDates.length,
          skipped: conflicts.length,
          skippedReasons: conflicts.map(c => c.message),
        });
      }

      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const courseName = (id) => courses.find(c => c.id === id)?.name || "—";
  const roomName = (id) => rooms.find(r => r.id === id)?.name || "—";
  const sessionCount = (eventId) => sessions.filter(s => s.event_id === eventId && s.status === "active").length;

  const recurrenceLabel = (ev) => {
    if (ev.recurrence_type === "single") return `Data singola: ${formatData(ev.start_date)}`;
    if (ev.recurrence_type === "custom") return `Date personalizzate: ${ev.custom_dates?.length || 0} date`;
    const days = (ev.days_of_week || []).map(d => (DAYS_IT[d] || d).slice(0, 3)).join(", ");
    return `Settimanale: ${days} dal ${formatData(ev.start_date)}${ev.end_condition === "by_date" ? ` al ${formatData(ev.end_date)}` : ` (${ev.occurrence_count} occ.)`}`;
  };

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={openForm}><Plus className="w-4 h-4 mr-1" /> Nuovo evento</Button>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessun evento. Crea il primo evento per generare sessioni.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map(ev => (
            <Card key={ev.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <h4 className="font-medium mb-2">{courseName(ev.course_id)}</h4>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {ev.start_time}–{ev.end_time}</div>
                  <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {roomName(ev.room_id)}</div>
                  <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {recurrenceLabel(ev)}</div>
                  <div className="font-medium text-foreground pt-1">{sessionCount(ev.id)} sessioni</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog: nuovo evento */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo evento</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Corso *</Label>
                <Select value={form.course_id} onValueChange={v => setForm({ ...form, course_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sala *</Label>
                <Select value={form.room_id} onValueChange={v => setForm({ ...form, room_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>{rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.capacity} posti)</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inizio *</Label><Input type="time" required value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></div>
              <div><Label>Fine *</Label><Input type="time" required value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></div>
            </div>
            <div>
              <Label>Capienza (vuoto = eredita dalla sala)</Label>
              <Input type="number" min="0" placeholder={form.room_id ? `${rooms.find(r => r.id === form.room_id)?.capacity || ""} (sala)` : ""} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
            </div>
            <div>
              <Label>Ricorrenza *</Label>
              <Select value={form.recurrence_type} onValueChange={v => setForm({ ...form, recurrence_type: v, days_of_week: [], custom_dates: [], end_date: "", occurrence_count: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Data singola</SelectItem>
                  <SelectItem value="weekly">Settimanale</SelectItem>
                  <SelectItem value="custom">Date personalizzate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.recurrence_type === "single" && (
              <div><Label>Data *</Label><Input type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
            )}

            {form.recurrence_type === "weekly" && (
              <>
                <div>
                  <Label>Giorni della settimana *</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DAYS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          form.days_of_week.includes(d)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {(DAYS_IT[d] || d).slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
                <div><Label>Data inizio *</Label><Input type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div>
                  <Label>Fine ricorrenza *</Label>
                  <Select value={form.end_condition} onValueChange={v => setForm({ ...form, end_condition: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_date">Fino a una data</SelectItem>
                      <SelectItem value="by_count">Per numero di occorrenze</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.end_condition === "by_date" ? (
                  <div><Label>Data fine *</Label><Input type="date" required value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
                ) : (
                  <div><Label>Numero occorrenze totali *</Label><Input type="number" min="1" required value={form.occurrence_count} onChange={e => setForm({ ...form, occurrence_count: e.target.value })} placeholder="Es. 12 = 12 sessioni totali" /></div>
                )}
              </>
            )}

            {form.recurrence_type === "custom" && (
              <div>
                <Label>Date personalizzate *</Label>
                <div className="flex gap-2">
                  <Input type="date" value={customDateInput} onChange={e => setCustomDateInput(e.target.value)} />
                  <Button type="button" size="sm" onClick={addCustomDate}><Plus className="w-4 h-4" /></Button>
                </div>
                {form.custom_dates.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {form.custom_dates.map(d => (
                      <span key={d} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-sm">
                        {formatData(d)}
                        <button type="button" onClick={() => removeCustomDate(d)} className="text-muted-foreground hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Anteprima conteggio */}
            {previewCount > 0 && (
              <div className={`p-3 rounded-lg text-sm ${overLimit ? "bg-destructive/10 border border-destructive/30 text-destructive" : "bg-info/10 border border-info/30 text-info"}`}>
                {overLimit ? (
                  <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Questo pattern genera {previewCount} sessioni. Il massimo consentito è {MAX_SESSIONS}.</span>
                ) : (
                  <span>Questo pattern genererà <strong>{previewCount}</strong> sessioni.</span>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm whitespace-pre-line">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={saving || !form.course_id || !form.room_id || overLimit}>
              {saving ? "Generazione..." : "Crea evento e genera sessioni"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: riepilogo generazione */}
      <Dialog open={!!generationResult} onOpenChange={v => { if (!v) setGenerationResult(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Riepilogo generazione</DialogTitle></DialogHeader>
          {generationResult && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-lg bg-success/10 border border-success/30">
                  <p className="text-2xl font-bold text-success">{generationResult.created}</p>
                  <p className="text-xs text-success">Sessioni create</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <p className="text-2xl font-bold text-warning">{generationResult.skipped}</p>
                  <p className="text-xs text-warning">Saltate per conflitto</p>
                </div>
              </div>
              {generationResult.skippedReasons.length > 0 && (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground">Dettaglio date saltate:</p>
                  {generationResult.skippedReasons.map((r, i) => (
                    <p key={i} className="text-sm text-muted-foreground p-2 rounded bg-muted/40">{r}</p>
                  ))}
                </div>
              )}
              <Button onClick={() => setGenerationResult(null)} className="w-full">Chiudi</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}