import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { motivoSalaNonPrenotabile, saleProgrammabili, etichettaSalaNelPeriodo } from "@/core/domain/sale";
import { formatData } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";

const hhmm = (t) => String(t ?? "").slice(0, 5);

const MODULO_VUOTO = (giorno) => ({
  course_id: "", room_id: "", capacity: "",
  date: giorno || oggiIso(),
  start_time: "09:00", end_time: "10:00",
});

/** Il modulo come lo scrive una lezione già in calendario. */
const moduloDa = (lezione) => ({
  course_id: lezione.course_id,
  room_id: lezione.room_id,
  capacity: String(lezione.capacity ?? ""),
  date: lezione.date,
  start_time: hhmm(lezione.start_time),
  end_time: hhmm(lezione.end_time),
});

/** "14/09: sala occupata da «Yoga» 09:00–10:00" → la data a parte, il motivo accanto. */
function RigaConflitto({ testo }) {
  const i = testo.indexOf(": ");
  const data = i > 0 && i <= 5 ? testo.slice(0, i) : null;
  const resto = data ? testo.slice(i + 2) : testo;
  const motivo = resto.charAt(0).toUpperCase() + resto.slice(1);
  // L'orario in fondo non si spezza a metà.
  const orario = motivo.match(/\s(\d{2}:\d{2}–\d{2}:\d{2})$/);
  return (
    <li className="flex gap-3 px-3 py-2 text-sm">
      {data && <span className="shrink-0 font-medium tabular-nums">{data}</span>}
      <span className="text-muted-foreground">
        {orario ? <>{motivo.slice(0, orario.index)} <span className="whitespace-nowrap tabular-nums">{orario[1]}</span></> : motivo}
      </span>
    </li>
  );
}

/**
 * La finestra della lezione: crea una lezione singola, o modifica una lezione già in calendario.
 *
 * `modo` dice su che cosa lavora. In modo «lezione» (questo) tocca solo la riga di `sessions`:
 * «Nuova lezione» crea sempre una lezione singola, e la modifica cambia sala, orario e capienza
 * di quella lezione e basta, segnandola come modificata a mano. Le sessioni settimanali — il
 * giorno, l'orario di tutta la serie, la data fine — si creano e si cambiano da Sessioni.
 *
 * Il corso non si cambia: una lezione di Pilates non diventa Yoga, si elimina e se ne crea
 * un'altra. La data si cambia solo in una lezione singola: quella di una sessione cade nel suo
 * giorno della settimana.
 *
 * Le sovrapposizioni di sala e istruttore le conta il server (POST /api/calendario/conflitti),
 * mentre si compila: una lezione sopra un'altra non si crea e non si sposta.
 *
 * @param data      { courses, rooms } dal layout della sezione
 * @param lezione   in modifica, la lezione come la dà GET /api/calendario/lezioni
 * @param giorno    in creazione, la data già scritta (aperta dalla finestra del giorno)
 * @param onSalvata (idLezione) => void, dopo il salvataggio
 */
export default function EventFormDialog({ open, onClose, data, modo = "lezione", lezione = null, giorno = null, onSalvata }) {
  const { courses, rooms } = data;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => MODULO_VUOTO(giorno));
  // Le sovrapposizioni dell'orario scritto: null finché non si può chiedere, poi { conflitti } o { errore }.
  const [controllo, setControllo] = useState(null);
  const [mostraConflitti, setMostraConflitti] = useState(false);

  const inModifica = !!lezione;
  const singola = !inModifica || lezione.sessione?.recurrence_type === "single";

  useEffect(() => {
    if (!open) return;
    setError("");
    setMostraConflitti(false);
    setForm(lezione ? moduloDa(lezione) : MODULO_VUOTO(giorno));
    // Si riempie all'apertura: un ricaricamento mentre è aperta non cancella quello che si scrive.
  }, [open, lezione, giorno]);

  // La lezione si sposta se cambia giorno, sala o orario: solo allora si controllano le altre.
  const spostata = !inModifica || ["date", "room_id", "start_time", "end_time"].some((c) => form[c] !== moduloDa(lezione)[c]);
  const orarioValido = form.start_time && form.end_time && form.start_time < form.end_time;
  const controllabile = open && spostata && form.course_id && form.room_id && form.date && orarioValido;

  useEffect(() => {
    if (!controllabile) { setControllo(null); return; }
    let vivo = true;
    setControllo(null);
    const t = setTimeout(() => {
      api.calendario.conflitti({
        date: [form.date], start_time: form.start_time, end_time: form.end_time,
        room_id: form.room_id, course_id: form.course_id,
        escludi_lezioni: inModifica ? [lezione.id] : [],
      })
        .then((r) => { if (vivo) setControllo({ conflitti: r.conflitti }); })
        .catch((err) => { if (vivo) setControllo({ errore: err.message }); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [controllabile, form.date, form.start_time, form.end_time, form.room_id, form.course_id, inModifica, lezione]);

  const conflitti = controllo?.conflitti ?? [];

  const salaScelta = rooms.find((r) => r.id === form.room_id);
  // Una sala annullata, o sospesa proprio quel giorno: il server rifiuterebbe comunque, ma dopo
  // aver fatto compilare tutto il resto.
  const motivoSala = salaScelta && (!inModifica || form.room_id !== lezione.room_id || form.date !== lezione.date)
    ? motivoSalaNonPrenotabile(salaScelta, form.date, form.date) : null;
  // In modifica c'è anche la sala attuale, se nel frattempo è stata annullata.
  const saleInElenco = saleProgrammabili(rooms).concat(
    inModifica && salaScelta && salaScelta.stato === "annullato" && salaScelta.id === lezione.room_id ? [salaScelta] : []
  );
  // Un corso disattivato non si programma più: non si propone, tranne quello che la lezione ha già.
  const corsiInElenco = courses.filter((c) => c.attivo !== false || (inModifica && c.id === lezione.course_id));

  const chiudi = () => { setMostraConflitti(false); onClose(); };

  const crea = async () => {
    const dati = {
      course_id: form.course_id, room_id: form.room_id, capacity: Number(form.capacity),
      recurrence_type: "single", start_date: form.date, start_time: form.start_time, end_time: form.end_time,
    };
    const evento = await api.entities.Event.create(dati);
    try {
      const nuova = await api.entities.Session.create({
        event_id: evento.id, date: form.date, start_time: form.start_time, end_time: form.end_time,
        room_id: form.room_id, capacity: dati.capacity, status: "active", modified_manually: false,
      });
      return nuova.id;
    } catch (err) {
      // Senza la sua lezione la riga di `events` non serve a niente: non resta in giro.
      await api.entities.Event.delete(evento.id).catch(() => {});
      throw err;
    }
  };

  const modifica = async () => {
    const prima = moduloDa(lezione);
    const cambi = {};
    for (const c of ["room_id", "start_time", "end_time"]) if (form[c] !== prima[c]) cambi[c] = form[c];
    if (Number(form.capacity) !== Number(prima.capacity)) cambi.capacity = Number(form.capacity);
    if (singola && form.date !== prima.date) cambi.date = form.date;
    if (Object.keys(cambi).length === 0) return null;
    await api.entities.Session.update(lezione.id, { ...cambi, modified_manually: true });
    return lezione.id;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.course_id || !form.room_id || !form.date || !form.start_time || !form.end_time) return;
    if (motivoSala) { setError(motivoSala); return; }
    if (!orarioValido) { setError("L'orario di inizio deve precedere quello di fine."); return; }
    if (!(Number(form.capacity) > 0)) { setError("La capienza è di almeno una persona."); return; }
    if (inModifica && Number(form.capacity) < (lezione.confermati ?? 0)) {
      setError(`${lezione.confermati} soci sono già confermati: la capienza non può scendere a ${form.capacity}.`);
      return;
    }
    setSaving(true);
    try {
      // Il controllo si rifà al salvataggio: nel frattempo un collega può aver occupato la sala.
      if (spostata) {
        const r = await api.calendario.conflitti({
          date: [form.date], start_time: form.start_time, end_time: form.end_time,
          room_id: form.room_id, course_id: form.course_id, escludi_lezioni: inModifica ? [lezione.id] : [],
        });
        if (r.conflitti.length) {
          setControllo({ conflitti: r.conflitti });
          setMostraConflitti(true);
          setSaving(false);
          return;
        }
      }
      const id = inModifica ? await modifica() : await crea();
      if (inModifica && !id) {
        toast({ title: "Nessuna modifica da salvare" });
      } else {
        toast({
          title: inModifica ? "Lezione modificata" : "Lezione creata",
          description: `${formatData(form.date, "estesaBreve")}, ${form.start_time}–${form.end_time}`,
        });
        onSalvata?.(id);
      }
      chiudi();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <>
      <Dialog open={open && !mostraConflitti} onOpenChange={(v) => { if (!v) chiudi(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inModifica ? "Modifica lezione" : "Nuova lezione"}</DialogTitle>
            {inModifica && !singola && (
              <DialogDescription>
                Cambia solo questa lezione. Giorno, orario e sala di tutta la sessione si cambiano da Sessioni.
              </DialogDescription>
            )}
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3" data-modo={modo}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Corso *</Label>
                <Select value={form.course_id} disabled={inModifica} onValueChange={(v) => setForm({ ...form, course_id: v })}>
                  <SelectTrigger aria-label="Corso"><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>{corsiInElenco.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Sala *</Label>
                <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v })}>
                  <SelectTrigger aria-label="Sala"><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {saleInElenco.map((r) => (
                      <SelectItem
                        key={r.id} value={r.id}
                        disabled={!!motivoSalaNonPrenotabile(r, form.date, form.date) && r.id !== lezione?.room_id}
                      >
                        {etichettaSalaNelPeriodo(r, form.date, form.date)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="lezione-data">Data *</Label>
              <Input
                id="lezione-data" type="date" required disabled={!singola}
                value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="lezione-inizio">Inizio *</Label><Input id="lezione-inizio" type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
              <div><Label htmlFor="lezione-fine">Fine *</Label><Input id="lezione-fine" type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            </div>
            {/* La capienza si scrive qui e basta: la sala non ne ha più una da ereditare, perché
                nella stessa stanza uno spinning e un pilates non tengono lo stesso numero di persone. */}
            <div>
              <Label htmlFor="lezione-capienza">Capienza *</Label>
              <Input id="lezione-capienza" type="number" min="1" required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              {inModifica && lezione.confermati > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {lezione.confermati === 1 ? "1 socio già confermato." : `${lezione.confermati} soci già confermati.`}
                </p>
              )}
            </div>
            {motivoSala && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{motivoSala}</span>
              </div>
            )}
            {conflitti.length > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg text-sm border bg-destructive/10 border-destructive/30 text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">La lezione si sovrappone a un'altra.</span>
                <button
                  type="button" className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
                  onClick={() => setMostraConflitti(true)}
                >
                  Vedi
                </button>
              </div>
            )}
            {controllo?.errore && <p className="text-xs text-muted-foreground">Controllo delle sovrapposizioni non riuscito: {controllo.errore}</p>}
            {error && (
              <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm whitespace-pre-line">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
              </div>
            )}
            <Button
              type="submit" className="w-full"
              disabled={saving || !form.course_id || !form.room_id || !form.capacity || !!motivoSala || conflitti.length > 0}
            >
              {inModifica ? (saving ? "Salvataggio..." : "Salva modifiche") : (saving ? "Creazione..." : "Crea lezione")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Le sovrapposizioni, da leggere: si chiude e si torna al modulo con tutto quello che si era scritto. */}
      <Dialog open={open && mostraConflitti} onOpenChange={(v) => { if (!v) setMostraConflitti(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-warning" aria-hidden="true" />
              Data in conflitto
            </DialogTitle>
            <DialogDescription>
              {inModifica ? "La lezione non si può spostare così" : "La lezione non si può creare così"}: cambia orario, sala o data.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {conflitti.map((c, i) => <RigaConflitto key={i} testo={c.messaggio} />)}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => setMostraConflitti(false)}>Chiudi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
