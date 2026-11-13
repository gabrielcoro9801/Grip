import React, { useState, useEffect, useMemo } from "react";
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
import { DAYS, DAYS_IT } from "@/staff/lib/courseValidation";
import { generateSessionDates } from "@/staff/lib/eventUtils";
import { validateSessionsBulk } from "@/staff/lib/sessionValidation";
import {
  CAMPI_MODELLO, campiCambiati, lezioniDellaSerie, pianificaModifica, richiesteConflitti, conflittiPerLezione,
  spostaLeLezioni, descriviRimozione, nomeGiorno,
} from "@/staff/lib/modificaEvento";
import { cn } from "@/ui/utils";

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
 * La finestra di una lezione o di una sessione. `modo` dice su che cosa lavora:
 * - «lezione» (dal calendario e dalla pagina della lezione): crea una lezione singola, o cambia
 *   una lezione già in calendario e basta;
 * - «sessione» (da Sessioni): crea una sessione settimanale di un corso, o cambia sala, orario,
 *   capienza e data fine di tutta la sessione da oggi in poi.
 *
 * Le sovrapposizioni di sala e istruttore le conta il server (POST /api/calendario/conflitti).
 */
export default function EventFormDialog(props) {
  return props.modo === "sessione" ? <FormSessione {...props} /> : <FormLezione {...props} />;
}

/**
 * Modo «lezione»: tocca solo la riga di `sessions`. «Nuova lezione» crea sempre una lezione
 * singola, e la modifica cambia sala, orario e capienza di quella lezione e basta, segnandola
 * come modificata a mano. Le sessioni settimanali — il giorno, l'orario di tutta la sessione, la
 * data fine — si creano e si cambiano da Sessioni.
 *
 * Il corso non si cambia: una lezione di Pilates non diventa Yoga, si elimina e se ne crea
 * un'altra. La data si cambia solo in una lezione singola: quella di una sessione cade nel suo
 * giorno della settimana.
 *
 * Le sovrapposizioni si controllano mentre si compila: una lezione sopra un'altra non si crea e
 * non si sposta.
 *
 * @param data      { courses, rooms } dal layout della sezione
 * @param lezione   in modifica, la lezione come la dà GET /api/calendario/lezioni
 * @param giorno    in creazione, la data già scritta (aperta dalla finestra del giorno)
 * @param onSalvata (idLezione) => void, dopo il salvataggio
 */
function FormLezione({ open, onClose, data, modo = "lezione", lezione = null, giorno = null, onSalvata }) {
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

// Lo stesso tetto del server (MASSIMO_LEZIONI_NUOVE): una sessione di due anni in una volta è
// quasi sempre una data sbagliata.
const MASSIMO_LEZIONI = 104;

const scegli = (oggetto, campi) => Object.fromEntries(campi.filter((c) => c in oggetto).map((c) => [c, oggetto[c]]));
const frase = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

const SESSIONE_VUOTA = () => ({
  room_id: "", capacity: "", giorno: null,
  start_date: oggiIso(), end_condition: "by_date", end_date: "", occurrence_count: "",
  start_time: "09:00", end_time: "10:00",
});

/** Il modulo come lo scrive una sessione già in corso: la fine è sempre una data, l'ultima lezione. */
const moduloDaSessione = (s) => ({
  room_id: s.room_id, capacity: String(s.capacity ?? ""), giorno: s.giorno,
  start_date: s.start_date, end_condition: "by_date",
  end_date: (s.end_condition === "by_date" && s.end_date) || s.ultima_lezione || s.start_date,
  occurrence_count: "",
  start_time: hhmm(s.start_time), end_time: hhmm(s.end_time),
});

/** La sessione come la descrive il modulo di creazione. */
const datiSessione = (form, corso) => ({
  course_id: corso.id, room_id: form.room_id, capacity: Number(form.capacity),
  recurrence_type: "weekly", giorno: form.giorno, start_date: form.start_date,
  end_condition: form.end_condition,
  end_date: form.end_condition === "by_date" ? form.end_date : undefined,
  occurrence_count: form.end_condition === "by_count" ? Number(form.occurrence_count) : undefined,
  start_time: form.start_time, end_time: form.end_time,
});

/**
 * Modo «sessione»: una lezione che si ripete ogni settimana, stesso giorno e stessa ora.
 *
 * Il corso è quello della card da cui la si apre, e non si cambia. Il giorno è uno solo — sette
 * pulsanti a scelta unica: due giorni sono due sessioni. La fine è una data o un numero di
 * lezioni.
 *
 * In modifica giorno e inizio restano bloccati: cambiarli vorrebbe dire spostare ogni lezione,
 * con le prenotazioni sopra. Si cambiano sala, orario e capienza, per tutte le lezioni da oggi in
 * poi (una lezione già messa a parte tiene quello che non si è toccato), e la data fine:
 * allungandola nascono le lezioni mancanti, accorciandola si tolgono quelle oltre, con le regole
 * dell'eliminazione. Prima di farlo la finestra mostra i conti del server.
 *
 * @param corso     in creazione, il corso della card
 * @param sessione  in modifica, la sessione come la dà GET /api/calendario/sessioni
 * @param onSalvata () => void, dopo il salvataggio
 */
function FormSessione({ open, onClose, data, corso = null, sessione = null, onSalvata }) {
  const { rooms } = data;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(SESSIONE_VUOTA);
  // Il passaggio sopra il modulo: i conflitti da leggere o da confermare, i conti della data fine.
  const [passo, setPasso] = useState(null);
  // In creazione: le sovrapposizioni delle date che il modulo creerebbe. null finché non si può chiedere.
  const [controllo, setControllo] = useState(null);

  const inModifica = !!sessione;
  const oggi = oggiIso();
  const nomeCorso = sessione?.corso ?? corso?.name ?? "";

  useEffect(() => {
    if (!open) return;
    setError("");
    setPasso(null);
    setForm(sessione ? moduloDaSessione(sessione) : SESSIONE_VUOTA());
    // Si riempie all'apertura: un ricaricamento mentre è aperta non cancella quello che si scrive.
  }, [open, sessione]);

  const iniziali = useMemo(() => (sessione ? moduloDaSessione(sessione) : null), [sessione]);
  const orarioValido = form.start_time && form.end_time && form.start_time < form.end_time;

  // Le date che il modulo creerebbe.
  const date = useMemo(() => {
    if (inModifica || !form.giorno || !form.start_date) return [];
    if (form.end_condition === "by_date" ? !form.end_date || form.end_date < form.start_date : !(Number(form.occurrence_count) > 0)) return [];
    return generateSessionDates(datiSessione(form, { id: null }));
  }, [inModifica, form]);
  const troppe = date.length > MASSIMO_LEZIONI;
  const controllabile = open && !inModifica && date.length > 0 && !troppe && form.room_id && orarioValido;
  const chiaveDate = date.join(",");

  useEffect(() => {
    if (!controllabile) { setControllo(null); return undefined; }
    let vivo = true;
    setControllo(null);
    const t = setTimeout(() => {
      api.calendario.conflitti({
        date: chiaveDate.split(","), start_time: form.start_time, end_time: form.end_time, room_id: form.room_id, course_id: corso?.id,
      })
        .then((r) => { if (vivo) setControllo(r); })
        .catch((err) => { if (vivo) setControllo({ errore: err.message }); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [controllabile, chiaveDate, form.start_time, form.end_time, form.room_id, corso?.id]);

  const conflittiAnteprima = controllo?.conflitti ?? [];
  const tutteInConflitto = conflittiAnteprima.length > 0 && controllo.libere.length === 0;

  // Dal primo all'ultimo giorno che la sessione occuperà: di una sessione in modifica conta il
  // pezzo che si può ancora cambiare, da oggi alla fine.
  const periodo = inModifica
    ? [sessione.start_date > oggi ? sessione.start_date : oggi, form.end_date || iniziali.end_date]
    : [form.start_date, date[date.length - 1] ?? (form.end_condition === "by_date" ? form.end_date || null : null)];
  const salaScelta = rooms.find((r) => r.id === form.room_id);
  const motivoSala = salaScelta && (!inModifica || form.room_id !== iniziali.room_id)
    ? motivoSalaNonPrenotabile(salaScelta, periodo[0], periodo[1]) : null;
  // Una sala chiusa per una settimana va ancora bene per una sessione in corso: le lezioni che
  // cadono nella chiusura si vedono una per una al salvataggio. Una sessione nuova no.
  const salaBloccante = motivoSala && !inModifica;
  const saleInElenco = saleProgrammabili(rooms).concat(
    inModifica && salaScelta && salaScelta.stato === "annullato" && salaScelta.id === iniziali.room_id ? [salaScelta] : []
  );

  const chiudi = () => { setPasso(null); onClose(); };
  const fatto = () => { chiudi(); onSalvata?.(); };

  // === Creazione ===

  const crea = async (libere) => {
    setSaving(true);
    let evento = null;
    try {
      const dati = datiSessione(form, corso);
      evento = await api.entities.Event.create(dati);
      const lezioni = libere.map((d) => ({
        event_id: evento.id, date: d, start_time: dati.start_time, end_time: dati.end_time,
        room_id: dati.room_id, capacity: dati.capacity, status: "active", modified_manually: false,
      }));
      const { valid, errors } = validateSessionsBulk(lezioni, dati);
      if (!valid) throw new Error(`Lezioni non valide:\n${errors.join("\n")}`);
      await api.entities.Session.bulkCreate(lezioni);
      toast({ title: "Sessione creata", description: `${nomeCorso}, ${frase(libere.length, "lezione", "lezioni")} in calendario` });
      fatto();
    } catch (err) {
      // Senza le sue lezioni la sessione non serve a niente: non resta in giro.
      if (evento) await api.entities.Event.delete(evento.id).catch(() => {});
      setPasso(null);
      setError(err.message);
    }
    setSaving(false);
  };

  const mostraConflitti = (r) => {
    const libere = r.libere.length;
    setPasso({
      titolo: libere === 0 ? (r.conflitti.length === 1 ? "Data in conflitto" : "Tutte le date sono in conflitto") : "Date in conflitto",
      testo: libere === 0
        ? "Nessuna lezione si può creare così: cambia orario, sala o date."
        : `Se crei la sessione, ${r.conflitti.length === 1 ? "questa data verrà saltata" : "queste date verranno saltate"}.`,
      problemi: r.conflitti.map((c) => c.messaggio),
      onChiudi: () => setPasso(null),
    });
  };

  const handleCreate = async () => {
    if (!form.giorno) { setError("Scegli il giorno della settimana."); return; }
    if (form.end_condition === "by_date" && !form.end_date) { setError("La data fine è obbligatoria."); return; }
    if (form.end_condition === "by_date" && form.end_date < form.start_date) { setError("La data fine non può precedere quella di inizio."); return; }
    if (form.end_condition === "by_count" && !(Number(form.occurrence_count) > 0)) { setError("Indica per quante lezioni."); return; }
    if (troppe) { setError(`Così si creerebbero ${date.length} lezioni: il massimo in una volta è ${MASSIMO_LEZIONI}.`); return; }
    if (date.length === 0) { setError("Nessuna lezione fra quelle date: controlla giorno, inizio e fine."); return; }
    setSaving(true);
    try {
      // Il controllo si rifà al salvataggio: nel frattempo un collega può aver occupato la sala.
      const r = await api.calendario.conflitti({
        date, start_time: form.start_time, end_time: form.end_time, room_id: form.room_id, course_id: corso.id,
      });
      setControllo(r);
      setSaving(false);
      if (r.libere.length === 0) { mostraConflitti(r); return; }
      if (r.conflitti.length > 0) {
        // Qualche data in conflitto: non si crea niente finché non lo si decide.
        setPasso({
          titolo: "Date in conflitto",
          testo: `${frase(r.libere.length, "lezione su", "lezioni su")} ${date.length} ${r.libere.length === 1 ? "verrà creata" : "verranno create"}: le date in conflitto saranno saltate.`,
          problemi: r.conflitti.map((c) => c.messaggio),
          conferma: "Crea comunque",
          onConferma: () => crea(r.libere),
          onChiudi: () => setPasso(null),
        });
        return;
      }
      await crea(r.libere);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  // === Modifica ===

  /**
   * La data fine: prima i conti del server (lezioni da aggiungere, da togliere, soci da avvisare),
   * poi le sovrapposizioni delle lezioni nuove, e una conferma che racconta tutto. Le date in
   * conflitto si saltano; quelle in cui la sala è chiusa le salta già il server.
   *
   * `giaSalvato`: sala, orario o capienza sono già scritti, quindi «Annulla» chiude invece di
   * tornare al modulo (che mostrerebbe i valori di prima).
   */
  const avviaDataFine = async (nuovaFine, { giaSalvato = false } = {}) => {
    const annulla = giaSalvato ? fatto : () => setPasso(null);
    setSaving(true);
    try {
      const a = await api.calendario.dataFine(sessione.id, { end_date: nuovaFine, anteprima: true });
      const { conflitti } = a.nuove.length
        ? await api.calendario.conflitti({
          date: a.nuove, start_time: a.modello.start_time, end_time: a.modello.end_time, room_id: a.modello.room_id,
          course_id: sessione.course_id, escludi_evento_id: sessione.id,
        })
        : { conflitti: [] };
      const salta = conflitti.map((c) => c.data);
      const conti = { ...a, aggiunte: a.nuove.length - salta.length };
      const problemi = [
        ...a.saltate_sala.map((s) => `${formatData(s.date, "breve").slice(0, 5)}: ${s.motivo}`),
        ...conflitti.map((c) => c.messaggio),
      ];
      setPasso({
        titolo: "Cambiare la data fine?",
        testo: `Dal ${formatData(iniziali.end_date, "breve")} al ${formatData(nuovaFine, "breve")}. ${descriviRimozione(conti)}`
          + (problemi.length ? ` ${problemi.length === 1 ? "Questa data verrà saltata:" : "Queste date verranno saltate:"}` : ""),
        problemi,
        conferma: "Conferma",
        onConferma: () => applicaDataFine(nuovaFine, salta),
        onChiudi: annulla,
      });
    } catch (err) {
      setPasso(null);
      setError(err.message);
      if (giaSalvato) onSalvata?.();
    }
    setSaving(false);
  };

  const applicaDataFine = async (nuovaFine, salta) => {
    setSaving(true);
    try {
      const esito = await api.calendario.dataFine(sessione.id, { end_date: nuovaFine, salta });
      toast({ title: "Data fine cambiata", description: descriviRimozione(esito) });
      fatto();
    } catch (err) {
      setPasso(null);
      setError(err.message);
      onSalvata?.();
    }
    setSaving(false);
  };

  // `seguito`: la data fine, se è cambiata anche lei. Senza, la finestra si chiude.
  const scrivi = async ({ datiEvento, daScrivere, daSegnare }, messaggio, seguito = null) => {
    setSaving(true);
    let fatte = 0;
    try {
      // Prima la sessione: se il server la rifiuta, nessuna lezione è stata ancora toccata.
      if (Object.keys(datiEvento).length > 0) await api.entities.Event.update(sessione.id, datiEvento);
      for (const { lezione: l, dati } of daScrivere) {
        await api.entities.Session.update(l.id, dati);
        fatte++;
      }
      for (const l of daSegnare) await api.entities.Session.update(l.id, { modified_manually: true });
      toast({ title: "Sessione modificata", description: messaggio });
      setSaving(false);
      if (seguito) { await seguito(); return; }
      fatto();
      return;
    } catch (err) {
      setPasso(null);
      setError(fatte > 0
        ? `Modificate ${fatte} lezioni su ${daScrivere.length}, poi il salvataggio si è fermato: ${err.message}`
        : err.message);
      onSalvata?.();
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    const { end_date: nuovaFine, ...cambi } = campiCambiati(iniziali, form);
    if (Object.keys(cambi).length === 0 && !nuovaFine) {
      toast({ title: "Nessuna modifica da salvare" });
      chiudi();
      return;
    }
    if (nuovaFine) {
      if (nuovaFine < oggi) { setError("La data fine non può essere nel passato: per togliere le lezioni rimaste usa Elimina."); return; }
      if (nuovaFine < sessione.start_date) { setError("La data fine non può precedere l'inizio della sessione."); return; }
    }
    if (Object.keys(cambi).length === 0) { await avviaDataFine(nuovaFine); return; }

    setSaving(true);
    try {
      const { lezioni: tutte } = await api.calendario.lezioni({ evento_id: sessione.id, dal: oggi });
      const lezioni = lezioniDellaSerie(sessione, tutte, { oggi });
      // Il modello della sessione cambia con lei; ma se la sala nuova, nel periodo della
      // sessione, è stata chiusa, il server lo rifiuterebbe: il modello resta sulla vecchia e le
      // lezioni spostate risultano cambiate a parte.
      const datiEvento = scegli(cambi, CAMPI_MODELLO);
      if (datiEvento.room_id && motivoSalaNonPrenotabile(rooms.find((r) => r.id === datiEvento.room_id), sessione.start_date, iniziali.end_date)) {
        delete datiEvento.room_id;
      }
      const modello = { ...scegli(sessione, CAMPI_MODELLO), ...datiEvento };
      let conflitti = new Map();
      if (spostaLeLezioni(cambi) && lezioni.length) {
        const richieste = richiesteConflitti(lezioni, cambi);
        const risposte = await Promise.all(richieste.map((r) => api.calendario.conflitti({
          ...r.corpo, course_id: sessione.course_id, escludi_evento_id: sessione.id,
        })));
        conflitti = conflittiPerLezione(richieste, risposte);
      }
      const piano = { ...pianificaModifica(lezioni, cambi, modello, { rooms, conflitti }), datiEvento };
      const { problemi } = piano;
      const buone = lezioni.length - problemi.length;
      const descrizione = `${frase(buone, "lezione", "lezioni")} da oggi in poi`;
      const seguito = nuovaFine ? () => avviaDataFine(nuovaFine, { giaSalvato: true }) : null;
      setSaving(false);

      if (problemi.length > 0) {
        const elenco = problemi.map((p) => p.messaggio);
        if (buone === 0) {
          setPasso({ titolo: "Modifica non possibile", testo: "Cambia orario, sala o capienza e riprova.", problemi: elenco, onChiudi: () => setPasso(null) });
          return;
        }
        setPasso({
          titolo: "Lezioni in conflitto",
          testo: `${frase(buone, "lezione su", "lezioni su")} ${lezioni.length} ${buone === 1 ? "verrà modificata" : "verranno modificate"}: quelle in conflitto resteranno come sono.`,
          problemi: elenco,
          conferma: "Prosegui comunque",
          onConferma: () => scrivi(piano, descrizione, seguito),
          onChiudi: () => setPasso(null),
        });
        return;
      }
      await scrivi(piano, descrizione, seguito);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    if (!form.room_id || !form.start_time || !form.end_time) return;
    if (salaBloccante) { setError(motivoSala); return; }
    if (!orarioValido) { setError("L'orario di inizio deve precedere quello di fine."); return; }
    if (!(Number(form.capacity) > 0)) { setError("La capienza è di almeno una persona."); return; }
    if (inModifica) handleEdit(); else handleCreate();
  };

  const campo = (nome) => (e) => setForm({ ...form, [nome]: e.target.value });

  return (
    <>
      <Dialog open={open && !passo} onOpenChange={(v) => { if (!v && !saving) chiudi(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inModifica ? "Modifica sessione" : "Nuova sessione"}</DialogTitle>
            <DialogDescription>
              {inModifica
                ? `${nomeCorso} · ogni ${nomeGiorno(sessione.giorno)}. Le modifiche valgono per le lezioni da oggi in poi.`
                : `${nomeCorso}: una lezione ogni settimana, stesso giorno e stessa ora.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3" data-modo="sessione">
            <fieldset>
              <legend className="text-sm font-medium leading-none">Giorno *</legend>
              <div role="radiogroup" aria-label="Giorno della settimana" className="flex flex-wrap gap-2 mt-2">
                {DAYS.map((d) => {
                  const scelto = form.giorno === d;
                  return (
                    <button
                      key={d} type="button" role="radio" aria-checked={scelto} disabled={inModifica && !scelto}
                      aria-label={DAYS_IT[d]}
                      onClick={() => { if (!inModifica) setForm({ ...form, giorno: d }); }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        scelto ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
                        inModifica && "cursor-not-allowed",
                        inModifica && !scelto && "opacity-40 hover:bg-muted",
                      )}
                    >
                      {DAYS_IT[d].slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <Label>Sala *</Label>
              <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v })}>
                <SelectTrigger aria-label="Sala"><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {saleInElenco.map((r) => (
                    <SelectItem
                      key={r.id} value={r.id}
                      disabled={!inModifica && !!motivoSalaNonPrenotabile(r, periodo[0], periodo[1])}
                    >
                      {etichettaSalaNelPeriodo(r, periodo[0], periodo[1])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="sessione-inizio">Inizio *</Label><Input id="sessione-inizio" type="time" required value={form.start_time} onChange={campo("start_time")} /></div>
              <div><Label htmlFor="sessione-fine">Fine *</Label><Input id="sessione-fine" type="time" required value={form.end_time} onChange={campo("end_time")} /></div>
            </div>
            <div>
              <Label htmlFor="sessione-capienza">Capienza *</Label>
              <Input id="sessione-capienza" type="number" min="1" required value={form.capacity} onChange={campo("capacity")} />
            </div>
            <div>
              <Label htmlFor="sessione-dal">Data inizio *</Label>
              <Input id="sessione-dal" type="date" required disabled={inModifica} value={form.start_date} onChange={campo("start_date")} />
            </div>
            {!inModifica && (
              <div>
                <Label>Fine *</Label>
                <Select value={form.end_condition} onValueChange={(v) => setForm({ ...form, end_condition: v })}>
                  <SelectTrigger aria-label="Fine della sessione"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="by_date">Fino a una data</SelectItem>
                    <SelectItem value="by_count">Per N lezioni</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.end_condition === "by_date" ? (
              <div>
                <Label htmlFor="sessione-al">Data fine *</Label>
                <Input
                  id="sessione-al" type="date" required min={inModifica ? oggi : form.start_date || undefined}
                  value={form.end_date} onChange={campo("end_date")}
                />
                {inModifica && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Spostandola avanti si aggiungono le lezioni mancanti, indietro si tolgono quelle oltre.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label htmlFor="sessione-numero">Numero di lezioni *</Label>
                <Input id="sessione-numero" type="number" min="1" max={MASSIMO_LEZIONI} required value={form.occurrence_count} onChange={campo("occurrence_count")} />
              </div>
            )}
            {inModifica && (
              <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                Giorno e data inizio restano quelli: per cambiarli si elimina la sessione e se ne crea un'altra.
              </p>
            )}
            {motivoSala && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{motivoSala}{inModifica && " Le lezioni che cadono in quei giorni restano dove sono."}</span>
              </div>
            )}
            {date.length > 0 && (
              troppe ? (
                <div className="flex items-center gap-2 p-3 rounded-lg text-sm bg-destructive/10 border border-destructive/30 text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {date.length} lezioni: il massimo è {MASSIMO_LEZIONI}.
                </div>
              ) : conflittiAnteprima.length > 0 ? (
                <div className={cn("flex items-center gap-2 p-3 rounded-lg text-sm border", tutteInConflitto ? "bg-destructive/10 border-destructive/30 text-destructive" : "bg-warning/10 border-warning/30 text-warning")}>
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1">
                    {tutteInConflitto
                      ? (date.length === 1 ? "La data è in conflitto." : `Tutte le ${date.length} date sono in conflitto.`)
                      : `${frase(date.length, "lezione", "lezioni")}, ${conflittiAnteprima.length} in conflitto.`}
                  </span>
                  <button type="button" className="shrink-0 font-medium underline underline-offset-2 hover:no-underline" onClick={() => mostraConflitti(controllo)}>
                    Vedi
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-lg text-sm bg-info/10 border border-info/30 text-info">
                  {date.length === 1 ? "Verrà creata 1 lezione" : <>Verranno create <strong>{date.length}</strong> lezioni</>}
                  {`, dal ${formatData(date[0], "breve")} al ${formatData(date[date.length - 1], "breve")}.`}
                </div>
              )
            )}
            {controllo?.errore && <p className="text-xs text-muted-foreground">Controllo delle sovrapposizioni non riuscito: {controllo.errore}</p>}
            {error && (
              <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm whitespace-pre-line">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
              </div>
            )}
            <Button
              type="submit" className="w-full"
              disabled={saving || !form.room_id || !form.capacity || (!inModifica && !form.giorno) || troppe || tutteInConflitto || !!salaBloccante}
            >
              {inModifica ? (saving ? "Salvataggio..." : "Salva modifiche") : (saving ? "Creazione..." : "Crea sessione")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* I conflitti e i conti: da confermare («Crea comunque», «Prosegui comunque», «Conferma») o solo da leggere. */}
      <Dialog open={open && !!passo} onOpenChange={(v) => { if (!v && !saving) passo?.onChiudi(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-warning" aria-hidden="true" />
              {passo?.titolo}
            </DialogTitle>
            <DialogDescription>{passo?.testo}</DialogDescription>
          </DialogHeader>
          {passo && (
            <>
              {passo.problemi.length > 0 && (
                <ul className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {passo.problemi.map((r, i) => <RigaConflitto key={i} testo={r} />)}
                </ul>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                {passo.onConferma ? (
                  <>
                    <Button variant="outline" onClick={passo.onChiudi} disabled={saving}>Annulla</Button>
                    <Button onClick={passo.onConferma} disabled={saving}>{saving ? "Salvataggio..." : passo.conferma}</Button>
                  </>
                ) : (
                  <Button onClick={passo.onChiudi}>Chiudi</Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
