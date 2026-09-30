import React, { useState, useMemo, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { DAYS, DAYS_IT } from "@/staff/lib/courseValidation";
import { motivoSalaNonPrenotabile, saleProgrammabili, etichettaSalaNelPeriodo } from "@/core/domain/sale";
import { generateSessionDates, checkEventConflicts } from "@/staff/lib/eventUtils";
import { validateSessionsBulk } from "@/staff/lib/sessionValidation";
import {
  hhmm, eUnaSerie, fineEvento, campiCambiati, lezioniDellaSerie, pianificaModifica, elencoGiorni, giorniInOrdine, CAMPI_MODELLO,
} from "@/staff/lib/modificaEvento";
import { toIsoDate, formatData } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";

const MAX_SESSIONS = 104;

const MODULO_VUOTO = () => ({
  course_id: "", room_id: "", capacity: "",
  recurrence_type: "single", days_of_week: [],
  start_date: toIsoDate(new Date()),
  end_condition: "by_date", end_date: "", occurrence_count: "",
  start_time: "09:00", end_time: "10:00",
});

const scegli = (oggetto, campi) => Object.fromEntries(campi.filter((c) => c in oggetto).map((c) => [c, oggetto[c]]));

/**
 * La finestra dell'evento: crea, e modifica.
 *
 * Una finestra sola per le due cose, come in un calendario qualunque: chi modifica ritrova i
 * campi dove li ha scritti. In modifica arriva `lezione`, la lezione su cui si è cliccato, e il
 * modulo si apre con i suoi valori.
 *
 * Le date personalizzate non si creano più: un evento è una data singola o una regola
 * settimanale. Gli eventi a date scelte già in calendario si modificano come serie.
 *
 * In modifica, di una serie si cambiano corso, sala, orario e capienza; giorni e periodo restano
 * quelli. Cambiarli vorrebbe dire aggiungere o togliere lezioni con soci già prenotati, e come
 * si annulla una lezione è ancora da decidere. Al salvataggio si sceglie se cambiare solo la
 * lezione cliccata o tutta la serie da oggi in poi — e, di una serie settimanale, in quali giorni.
 */
export default function EventFormDialog({ open, onClose, data, reload, lezione = null }) {
  const { courses, events, sessions, rooms, bookings } = data;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(MODULO_VUOTO);
  // In modifica: com'era all'apertura, e quali giorni della serie cambiare.
  const [iniziali, setIniziali] = useState(null);
  const [giorniDaModificare, setGiorniDaModificare] = useState([]);
  // Il passaggio che si apre sopra il modulo: la scelta fra lezione e serie, o i conflitti.
  const [passo, setPasso] = useState(null);

  const evento = lezione ? events.find(e => e.id === lezione.event_id) : null;
  const inModifica = !!(lezione && evento);
  const serie = inModifica && eUnaSerie(evento);

  useEffect(() => {
    if (!open) return;
    setError("");
    setPasso(null);
    if (lezione) {
      const ev = events.find(e => e.id === lezione.event_id);
      if (!ev) return;
      const valori = {
        course_id: ev.course_id,
        room_id: lezione.room_id,
        capacity: String(lezione.capacity ?? ""),
        recurrence_type: ev.recurrence_type,
        days_of_week: ev.days_of_week || [],
        start_date: eUnaSerie(ev) ? ev.start_date : lezione.date,
        end_condition: ev.end_condition || "by_date",
        end_date: ev.end_date || "",
        occurrence_count: ev.occurrence_count ? String(ev.occurrence_count) : "",
        start_time: hhmm(lezione.start_time),
        end_time: hhmm(lezione.end_time),
      };
      setForm(valori);
      setIniziali({ ...valori, date: lezione.date });
      setGiorniDaModificare(giorniInOrdine(ev.days_of_week));
    } else {
      setForm(MODULO_VUOTO());
      setIniziali(null);
    }
    // Si riempie all'apertura: un ricaricamento dei dati mentre è aperto non cancella quello
    // che si sta scrivendo.
  }, [open, lezione]);

  const oggi = oggiIso();

  const previewCount = useMemo(() => {
    if (inModifica || !form.start_date) return 0;
    if (form.recurrence_type === "weekly" && form.days_of_week.length === 0) return 0;
    try {
      return generateSessionDates({
        recurrence_type: form.recurrence_type, start_date: form.start_date,
        days_of_week: form.days_of_week, end_condition: form.end_condition,
        end_date: form.end_date, occurrence_count: form.occurrence_count,
      }).length;
    } catch { return 0; }
  }, [form, inModifica]);

  const overLimit = previewCount > MAX_SESSIONS;

  // Le lezioni che "tutta la serie" cambierebbe, con i giorni scelti adesso.
  const lezioniSerie = useMemo(() => {
    if (!serie) return [];
    const giorni = evento.recurrence_type === "weekly" ? giorniDaModificare : null;
    return lezioniDellaSerie(evento, sessions, { giorni, oggi });
  }, [serie, evento, sessions, giorniDaModificare, oggi]);

  // Dal primo all'ultimo giorno che l'evento occuperà. Un settimanale contato a occorrenze non
  // sa quando finisce finché non genera le sessioni: `null` vuol dire "senza fine nota", e una
  // sala sospesa più avanti viene comunque considerata occupata. Di una serie in modifica conta
  // il pezzo che si può ancora cambiare, da oggi alla fine.
  const periodo = useMemo(() => {
    if (serie) return [evento.start_date > oggi ? evento.start_date : oggi, fineEvento(evento)];
    if (form.recurrence_type === "weekly") {
      return [form.start_date, form.end_condition === "by_date" ? (form.end_date || null) : null];
    }
    return [form.start_date, form.start_date];
  }, [serie, evento, oggi, form.recurrence_type, form.start_date, form.end_condition, form.end_date]);

  // Le sale che in quel periodo non si possono prenotare — annullate per sempre, o sospese
  // proprio allora — con il motivo accanto al nome. Il server rifiuterebbe comunque, ma dopo
  // aver fatto compilare tutto il resto.
  const saleNonPrenotabili = useMemo(() => {
    const per = new Map();
    for (const r of rooms) {
      const motivo = motivoSalaNonPrenotabile(r, periodo[0], periodo[1]);
      if (motivo) per.set(r.id, motivo);
    }
    return per;
  }, [rooms, periodo]);
  const salaScelta = rooms.find(r => r.id === form.room_id);
  // Le date si cambiano dopo aver scelto la sala: una sala valida quando è stata scelta può
  // finire dentro la sua sospensione mentre si compila il resto del modulo. Di una serie in
  // modifica, invece, una sala chiusa per una settimana va ancora bene per le altre: le lezioni
  // che cadono nella chiusura si vedono una per una al salvataggio.
  const motivoSalaScelta = salaScelta && (!inModifica || form.room_id !== iniziali?.room_id)
    ? saleNonPrenotabili.get(salaScelta.id) : undefined;
  const salaBloccante = motivoSalaScelta && !serie;

  // Le sale fra cui scegliere; in modifica c'è anche quella attuale, se nel frattempo è stata annullata.
  const saleInElenco = saleProgrammabili(rooms).concat(
    inModifica && salaScelta && salaScelta.stato === "annullato" && salaScelta.id === iniziali?.room_id ? [salaScelta] : []
  );
  // Un corso disattivato non si programma più: non si propone, tranne quello che l'evento ha già.
  const corsiInElenco = courses.filter(c => c.attivo !== false || (inModifica && c.id === evento.course_id));

  const toggleDay = (day) => {
    if (inModifica) {
      setGiorniDaModificare(prev => prev.includes(day) ? prev.filter(d => d !== day) : giorniInOrdine([...prev, day]));
      return;
    }
    setForm(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day) ? prev.days_of_week.filter(d => d !== day) : [...prev.days_of_week, day],
    }));
  };

  const chiudi = () => { setPasso(null); onClose(); };

  // === Creazione ===

  const crea = async (eventData, dates) => {
    setSaving(true);
    try {
      const createdEvent = await api.entities.Event.create(eventData);
      const sessionRecords = dates.map(date => ({
        event_id: createdEvent.id, date,
        start_time: eventData.start_time, end_time: eventData.end_time,
        room_id: eventData.room_id, capacity: eventData.capacity,
        status: "active", modified_manually: false,
      }));
      const { valid, errors: validationErrors } = validateSessionsBulk(sessionRecords, eventData);
      if (!valid) { throw new Error(`Validazione sessioni fallita:\n${validationErrors.join("\n")}`); }
      await api.entities.Session.bulkCreate(sessionRecords);
      toast({ title: "Evento creato", description: dates.length === 1 ? "1 lezione in calendario" : `${dates.length} lezioni in calendario` });
      chiudi();
      reload();
    } catch (err) {
      setPasso(null);
      setError(err.message);
    }
    setSaving(false);
  };

  const handleCreate = () => {
    if (form.recurrence_type === "weekly") {
      if (form.days_of_week.length === 0) { setError("Seleziona almeno un giorno della settimana."); return; }
      if (form.end_condition === "by_date" && !form.end_date) { setError("La data di fine è obbligatoria."); return; }
      if (form.end_condition === "by_date" && form.end_date < form.start_date) { setError("La data di fine non può precedere quella di inizio."); return; }
      if (form.end_condition === "by_count" && (!form.occurrence_count || Number(form.occurrence_count) <= 0)) { setError("Il numero di occorrenze è obbligatorio."); return; }
    }
    const weekly = form.recurrence_type === "weekly";
    const eventData = {
      course_id: form.course_id, room_id: form.room_id,
      capacity: Number(form.capacity),
      recurrence_type: form.recurrence_type,
      days_of_week: weekly ? form.days_of_week : undefined,
      start_date: form.start_date,
      end_condition: weekly ? form.end_condition : undefined,
      end_date: weekly && form.end_condition === "by_date" ? form.end_date : undefined,
      occurrence_count: weekly && form.end_condition === "by_count" ? Number(form.occurrence_count) : undefined,
      start_time: form.start_time, end_time: form.end_time,
    };

    const dates = generateSessionDates(eventData);
    if (dates.length > MAX_SESSIONS) {
      setError(`Questo pattern genera ${dates.length} sessioni, il massimo consentito in una sola creazione è ${MAX_SESSIONS}. Riduci l'intervallo di date o il numero di occorrenze.`);
      return;
    }
    if (dates.length === 0) { setError("Nessuna data generata. Controlla i parametri di ricorrenza."); return; }

    const course = courses.find(c => c.id === form.course_id);
    const { conflicts, cleanDates } = checkEventConflicts(dates, eventData, course, sessions, events, courses);
    if (cleanDates.length === 0) {
      setError(conflicts.length === 1
        ? `La data è in conflitto: l'evento non è stato creato.\n${conflicts[0].message}`
        : `Tutte le ${conflicts.length} date sono in conflitto: l'evento non è stato creato.\n${conflicts.map(c => c.message).join("\n")}`);
      return;
    }
    // Qualche data in conflitto: non si crea niente finché non lo si decide. O le lezioni
    // possibili, o nessuna.
    if (conflicts.length > 0) {
      setPasso({
        tipo: "conflitti",
        titolo: `${conflicts.length} ${conflicts.length === 1 ? "data è" : "date sono"} in conflitto`,
        testo: `Le altre ${cleanDates.length} lezioni si possono creare. Le date in conflitto restano fuori dalla serie.`,
        problemi: conflicts.map(c => c.message),
        conferma: `Crea comunque ${cleanDates.length === 1 ? "l'unica lezione possibile" : `le ${cleanDates.length} lezioni possibili`}`,
        annulla: "Annulla tutto",
        onConferma: () => crea(eventData, cleanDates),
        onAnnulla: chiudi,
      });
      return;
    }
    crea(eventData, dates);
  };

  // === Modifica ===

  /**
   * Esegue la modifica su `ambito`: "evento" (un evento singolo, che è la sua lezione),
   * "lezione" (solo la lezione cliccata di una serie) o "serie" (da oggi in poi, nei giorni scelti).
   */
  const pianifica = (ambito, cambi) => {
    const tuttiIGiorni = evento.recurrence_type !== "weekly" || giorniDaModificare.length === giorniInOrdine(evento.days_of_week).length;
    // Il modello dell'evento cambia quando cambia tutto l'evento: un evento singolo, o la serie
    // in tutti i suoi giorni. Cambiando solo il martedì, il modello resta quello del giovedì.
    const cambiaModello = ambito === "evento" || (ambito === "serie" && tuttiIGiorni);
    const datiEvento = cambiaModello ? scegli(cambi, ["course_id", ...CAMPI_MODELLO]) : {};
    if (ambito === "evento" && cambi.date) datiEvento.start_date = cambi.date;
    // Il server controlla la sala sull'intero periodo della serie, passato compreso: se la
    // nuova sala in quel periodo è stata chiusa, il modello resta sulla vecchia e le lezioni
    // spostate risultano cambiate a parte.
    if (ambito === "serie" && datiEvento.room_id) {
      const sala = rooms.find(r => r.id === datiEvento.room_id);
      if (motivoSalaNonPrenotabile(sala, evento.start_date, fineEvento(evento))) delete datiEvento.room_id;
    }
    const modello = { ...scegli(evento, CAMPI_MODELLO), ...scegli(datiEvento, CAMPI_MODELLO) };
    const lezioni = ambito === "serie" ? lezioniSerie : [lezione];
    const corso = courses.find(c => c.id === (cambi.course_id ?? evento.course_id));
    const piano = pianificaModifica(lezioni, cambi, modello, { sessions, events, courses, rooms, bookings, corso });
    return { ...piano, datiEvento, quante: lezioni.length };
  };

  const scrivi = async ({ datiEvento, daScrivere, daSegnare }, messaggio) => {
    setSaving(true);
    let fatte = 0;
    try {
      // Prima l'evento: se il server lo rifiuta, nessuna lezione è stata ancora toccata.
      if (Object.keys(datiEvento).length > 0) await api.entities.Event.update(evento.id, datiEvento);
      for (const { lezione: l, dati } of daScrivere) {
        await api.entities.Session.update(l.id, dati);
        fatte++;
      }
      for (const l of daSegnare) await api.entities.Session.update(l.id, { modified_manually: true });
      toast({ title: "Modifica salvata", description: messaggio });
      chiudi();
    } catch (err) {
      setPasso(null);
      setError(fatte > 0
        ? `Modificate ${fatte} lezioni su ${daScrivere.length}, poi il salvataggio si è fermato: ${err.message}`
        : err.message);
    }
    setSaving(false);
    reload();
  };

  const esegui = (ambito, cambi) => {
    const piano = pianifica(ambito, cambi);
    const { problemi, quante } = piano;
    const elenco = problemi.map(p => p.messaggio);
    const descrizione = ambito === "serie"
      ? `${quante - problemi.length} ${quante - problemi.length === 1 ? "lezione della serie" : "lezioni della serie"}`
      : "La lezione è aggiornata";

    if (problemi.length > 0) {
      // Il corso vale per tutto l'evento: non si cambia a metà, lasciando fuori le lezioni in conflitto.
      if (ambito !== "serie" || problemi.length === quante || cambi.course_id) {
        setPasso(null);
        setError(`La modifica non si può salvare:\n${elenco.join("\n")}`);
        return;
      }
      setPasso({
        tipo: "conflitti",
        titolo: `${problemi.length} ${problemi.length === 1 ? "lezione non si può modificare" : "lezioni non si possono modificare"}`,
        testo: `Le altre ${quante - problemi.length} si possono modificare; queste resterebbero come sono.`,
        problemi: elenco,
        conferma: `Modifica comunque le altre ${quante - problemi.length}`,
        annulla: "Annulla",
        onConferma: () => scrivi(piano, descrizione),
        onAnnulla: () => setPasso(null),
      });
      return;
    }
    scrivi(piano, descrizione);
  };

  const handleEdit = () => {
    const dopo = { ...form, date: serie ? lezione.date : form.start_date };
    const cambi = campiCambiati(iniziali, dopo);
    if (Object.keys(cambi).length === 0) {
      toast({ title: "Nessuna modifica da salvare" });
      chiudi();
      return;
    }
    if (!serie) { esegui("evento", cambi); return; }
    setPasso({ tipo: "ambito", cambi });
  };

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    if (!form.course_id || !form.room_id || !form.start_time || !form.end_time) return;
    if (salaBloccante) { setError(motivoSalaScelta); return; }
    if (form.start_time >= form.end_time) { setError("L'orario di inizio deve precedere quello di fine."); return; }
    if (!(Number(form.capacity) > 0)) { setError("La capienza è di almeno una persona."); return; }
    if (inModifica) handleEdit(); else handleCreate();
  };

  const corsoCambiato = passo?.tipo === "ambito" && "course_id" in passo.cambi;
  const tuttiIGiorni = !serie || evento.recurrence_type !== "weekly" || giorniDaModificare.length === giorniInOrdine(evento.days_of_week).length;
  const perLaSerie = evento?.recurrence_type === "weekly" && !tuttiIGiorni
    ? ` del ${elencoGiorni(giorniDaModificare)}` : "";

  return (
    <>
      <Dialog open={open && !passo} onOpenChange={v => { if (!v) chiudi(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{inModifica ? "Modifica evento" : "Nuovo evento"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Corso *</Label>
                <Select value={form.course_id} onValueChange={v => setForm({ ...form, course_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>{corsiInElenco.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Sala *</Label>
                <Select value={form.room_id} onValueChange={v => setForm({ ...form, room_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {saleInElenco.map(r => (
                      <SelectItem key={r.id} value={r.id} disabled={!serie && saleNonPrenotabili.has(r.id) && r.id !== iniziali?.room_id}>
                        {etichettaSalaNelPeriodo(r, periodo[0], periodo[1])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inizio *</Label><Input type="time" required value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></div>
              <div><Label>Fine *</Label><Input type="time" required value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></div>
            </div>
            {motivoSalaScelta && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{motivoSalaScelta}{serie && " Le lezioni che cadono in quei giorni restano dove sono."}</span>
              </div>
            )}
            {/* La capienza si scrive qui e basta: la sala non ne ha più una da ereditare, perché
                nella stessa stanza uno spinning e un pilates non tengono lo stesso numero di persone. */}
            <div><Label>Capienza *</Label><Input type="number" min="1" required value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} /></div>
            <div><Label>Ricorrenza *</Label>
              <Select value={form.recurrence_type} disabled={inModifica} onValueChange={v => setForm({ ...form, recurrence_type: v, days_of_week: [], end_date: "", occurrence_count: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Data singola</SelectItem>
                  <SelectItem value="weekly">Settimanale</SelectItem>
                  {/* Solo per mostrare gli eventi di prima: date personalizzate non se ne creano più. */}
                  {form.recurrence_type === "custom" && <SelectItem value="custom">Date personalizzate</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {form.recurrence_type === "single" && (
              <div><Label>Data *</Label><Input type="date" required value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
            )}
            {form.recurrence_type === "weekly" && (
              <>
                <div>
                  <Label>{inModifica ? "Giorni della serie da modificare *" : "Giorni della settimana *"}</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DAYS.map(d => {
                      const dellaSerie = !inModifica || form.days_of_week.includes(d);
                      const scelto = inModifica ? giorniDaModificare.includes(d) : form.days_of_week.includes(d);
                      return (
                        <button
                          key={d} type="button" onClick={() => toggleDay(d)} disabled={!dellaSerie} aria-pressed={scelto}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${scelto ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"} ${!dellaSerie ? "opacity-40 cursor-not-allowed hover:bg-muted" : ""}`}
                        >
                          {(DAYS_IT[d] || d).slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                  {inModifica && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Valgono se al salvataggio scegli tutta la serie. Togli un giorno per lasciarne le lezioni come sono.
                    </p>
                  )}
                </div>
                <div><Label>Data inizio *</Label><Input type="date" required disabled={inModifica} value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><Label>Fine ricorrenza *</Label>
                  <Select value={form.end_condition} disabled={inModifica} onValueChange={v => setForm({ ...form, end_condition: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="by_date">Fino a una data</SelectItem><SelectItem value="by_count">Per numero di occorrenze</SelectItem></SelectContent>
                  </Select>
                </div>
                {form.end_condition === "by_date" ? (
                  <div><Label>Data fine *</Label><Input type="date" required disabled={inModifica} value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
                ) : (
                  <div><Label>Numero occorrenze totali *</Label><Input type="number" min="1" required disabled={inModifica} value={form.occurrence_count} onChange={e => setForm({ ...form, occurrence_count: e.target.value })} placeholder="Es. 12 = 12 sessioni totali" /></div>
                )}
              </>
            )}
            {serie && (
              <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                Giorni e periodo della serie restano quelli: qui si cambiano corso, sala, orario e capienza.
                {evento.recurrence_type === "custom" && ` È una serie a date scelte (${lezioniSerie.length} lezioni da oggi in poi).`}
              </p>
            )}
            {previewCount > 0 && (
              <div className={`p-3 rounded-lg text-sm ${overLimit ? "bg-destructive/10 border border-destructive/30 text-destructive" : "bg-info/10 border border-info/30 text-info"}`}>
                {overLimit ? <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Questo pattern genera {previewCount} sessioni. Il massimo è {MAX_SESSIONS}.</span>
                  : <span>Questo pattern genererà <strong>{previewCount}</strong> sessioni.</span>}
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm whitespace-pre-line">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={saving || !form.course_id || !form.room_id || overLimit || !!salaBloccante || !form.capacity}>
              {inModifica ? (saving ? "Salvataggio..." : "Salva modifiche") : (saving ? "Generazione..." : "Crea evento e genera sessioni")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Solo questa lezione, o tutta la serie: come in ogni calendario, lo si chiede al salvataggio. */}
      <Dialog open={open && passo?.tipo === "ambito"} onOpenChange={v => { if (!v && !saving) setPasso(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modificare la serie?</DialogTitle>
            <DialogDescription>Questa lezione fa parte di una serie. Cosa vuoi cambiare?</DialogDescription>
          </DialogHeader>
          {passo?.tipo === "ambito" && lezione && (
            <div className="space-y-2">
              <SceltaAmbito
                titolo="Solo questa lezione"
                dettaglio={corsoCambiato ? "Il corso vale per tutta la serie: da una lezione sola non si cambia." : formatData(lezione.date, "estesa")}
                disabled={saving || corsoCambiato}
                onClick={() => esegui("lezione", passo.cambi)}
              />
              <SceltaAmbito
                titolo="Tutta la serie"
                dettaglio={
                  corsoCambiato && !tuttiIGiorni ? "Per cambiare il corso scegli tutti i giorni della serie."
                    : lezioniSerie.length === 0 ? "Nella serie non ci sono lezioni da oggi in poi" + (perLaSerie ? ` il ${elencoGiorni(giorniDaModificare)}.` : ".")
                    : `${lezioniSerie.length} ${lezioniSerie.length === 1 ? "lezione" : "lezioni"}${perLaSerie}, da oggi in poi`
                    + (lezioniSerie.some(l => l.id === lezione.id) ? "" : " (questa esclusa)")
                }
                disabled={saving || lezioniSerie.length === 0 || (corsoCambiato && !tuttiIGiorni)}
                onClick={() => esegui("serie", passo.cambi)}
              />
              <Button variant="ghost" className="w-full" onClick={() => setPasso(null)} disabled={saving}>Annulla</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Qualche data non va: si decide se procedere con le altre o lasciar perdere. */}
      <Dialog open={open && passo?.tipo === "conflitti"} onOpenChange={v => { if (!v && !saving) passo?.onAnnulla(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{passo?.titolo}</DialogTitle>
            <DialogDescription>{passo?.testo}</DialogDescription>
          </DialogHeader>
          {passo?.tipo === "conflitti" && (
            <div className="space-y-3">
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {passo.problemi.map((r, i) => <p key={i} className="text-sm text-muted-foreground p-2 rounded bg-muted/40">{r}</p>)}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button variant="outline" className="flex-1" onClick={passo.onAnnulla} disabled={saving}>{passo.annulla}</Button>
                <Button className="flex-1" onClick={passo.onConferma} disabled={saving}>{saving ? "Salvataggio..." : passo.conferma}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SceltaAmbito({ titolo, dettaglio, disabled, onClick }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <span className="block font-medium text-sm">{titolo}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{dettaglio}</span>
    </button>
  );
}
