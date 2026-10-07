// La modifica di un evento dal calendario: quali lezioni tocca, cosa scrivere su ciascuna, e
// quali non si possono cambiare e perché. Niente React e niente rete: la finestra chiede, questo
// modulo decide, e i test lo provano senza browser (modificaEvento.test.js).
//
// Import relativi con l'estensione, come eventUtils.js: così il file si carica con `node --test`.
import { DAYS, DAYS_IT, getDayOfWeekFromDate } from "./courseValidation.js";
import { checkSessionConflict } from "./eventUtils.js";
import { motivoSalaNonPrenotabile, dataIt } from "../../core/domain/sale.js";

/** "09:00:00" dal database, "09:00" dal modulo: si confrontano ore e minuti. */
export const hhmm = (t) => String(t ?? "").slice(0, 5);

/** Una serie ha più lezioni generate da una regola; un evento singolo ne ha una. */
export const eUnaSerie = (evento) => evento?.recurrence_type === "weekly" || evento?.recurrence_type === "custom";

// I campi che stanno su ogni lezione, e quelli che l'evento tiene come modello per le sue lezioni.
const CAMPI_LEZIONE = ["date", "room_id", "start_time", "end_time", "capacity"];
export const CAMPI_MODELLO = ["room_id", "start_time", "end_time", "capacity"];

const scegli = (oggetto, campi) => Object.fromEntries(campi.filter((c) => c in oggetto).map((c) => [c, oggetto[c]]));
const dataBreve = (iso) => dataIt(iso).slice(0, 5);

/** L'ultimo giorno dell'evento, o null se non è noto (settimanale a occorrenze). */
export function fineEvento(evento) {
  if (evento.recurrence_type === "weekly") return evento.end_condition === "by_date" ? evento.end_date || null : null;
  if (evento.recurrence_type === "custom") {
    const date = [...(evento.custom_dates || [])].sort();
    return date[date.length - 1] ?? evento.start_date;
  }
  return evento.start_date;
}

/** I giorni di una serie settimanale nell'ordine della settimana, da lunedì. */
export const giorniInOrdine = (giorni) => DAYS.filter((d) => (giorni || []).includes(d));

/** "martedì e giovedì" — per le frasi. */
export function elencoGiorni(giorni) {
  const nomi = giorniInOrdine(giorni).map((d) => (DAYS_IT[d] || d).toLowerCase());
  return nomi.length > 1 ? `${nomi.slice(0, -1).join(", ")} e ${nomi[nomi.length - 1]}` : nomi[0] ?? "";
}

/** La regola della serie in una riga: "Ogni martedì e giovedì, dal 01/10/2026 al 20/12/2026". */
export function descriviSerie(evento) {
  if (evento.recurrence_type === "custom") return "Date scelte una per una";
  if (evento.recurrence_type !== "weekly") return "";
  const fine = evento.end_condition === "by_count"
    ? `per ${evento.occurrence_count} lezioni`
    : `al ${dataIt(evento.end_date)}`;
  return `Ogni ${elencoGiorni(evento.days_of_week)}, dal ${dataIt(evento.start_date)} ${fine}`;
}

/**
 * Quello che il modulo ha cambiato rispetto a com'era all'apertura, e solo quello.
 *
 * Una serie a cui si sposta l'orario non si vede cambiare anche la sala: se una lezione era
 * stata messa a parte in un'altra stanza, ci resta. È ciò che ci si aspetta da un calendario —
 * si cambia la cosa che si è toccata.
 *
 * Il corso non c'è: in modifica non si cambia (un evento di Pilates non diventa Yoga — si
 * elimina e se ne crea un altro). La data fine sì, ma solo di una serie: `end_date` è un cambio
 * dell'intera serie, e lo applica il server (POST /api/calendario/eventi/:id/data-fine).
 */
export function campiCambiati(prima, dopo) {
  const cambi = {};
  if (dopo.room_id !== prima.room_id) cambi.room_id = dopo.room_id;
  if (hhmm(dopo.start_time) !== hhmm(prima.start_time)) cambi.start_time = hhmm(dopo.start_time);
  if (hhmm(dopo.end_time) !== hhmm(prima.end_time)) cambi.end_time = hhmm(dopo.end_time);
  if (Number(dopo.capacity) !== Number(prima.capacity)) cambi.capacity = Number(dopo.capacity);
  if (dopo.date !== prima.date) cambi.date = dopo.date;
  if (dopo.end_date && dopo.end_date !== prima.end_date) cambi.end_date = dopo.end_date;
  return cambi;
}

/**
 * Dove finisce una serie oggi: la data fine se c'è, altrimenti l'ultima lezione che ha in
 * calendario (una serie contata a occorrenze). È il valore da cui parte il campo "Data fine".
 */
export function fineAttualeSerie(evento, lezioni) {
  return fineEvento(evento)
    ?? lezioni.filter((l) => l.event_id === evento.id).map((l) => l.date).sort().pop()
    ?? evento.start_date;
}

const n = (quante, una, tante) => `${quante} ${quante === 1 ? una : tante}`;

/**
 * Cosa succederà togliendo delle lezioni, in una frase, dai conti del server:
 * { eliminate, annullate, soci_avvisati, aggiunte? }.
 */
export function descriviRimozione({ eliminate = 0, annullate = 0, soci_avvisati: avvisati = 0, aggiunte = 0 }) {
  const frasi = [];
  if (aggiunte) frasi.push(`${aggiunte === 1 ? "Verrà aggiunta" : "Verranno aggiunte"} ${n(aggiunte, "lezione", "lezioni")}.`);
  if (eliminate) frasi.push(`${eliminate === 1 ? "Verrà eliminata" : "Verranno eliminate"} ${n(eliminate, "lezione", "lezioni")} senza prenotazioni.`);
  if (annullate) {
    frasi.push(`${annullate === 1 ? "1 lezione ha prenotazioni: verrà annullata" : `${annullate} lezioni hanno prenotazioni: verranno annullate`}`
      + (avvisati ? `, e ${avvisati === 1 ? "1 socio riceverà" : `${avvisati} soci riceveranno`} un avviso nel portale.` : "."));
  }
  return frasi.join(" ") || "Nessuna lezione cambia.";
}

/**
 * Le lezioni che "tutta la serie" tocca: quelle ancora in calendario da oggi in poi, nei giorni
 * della settimana scelti (`giorni` null = tutti, come per le serie a date scelte).
 *
 * Il passato non si riscrive: una lezione già tenuta è andata con quell'orario e in quella sala,
 * e chi c'era era prenotato lì.
 */
export function lezioniDellaSerie(evento, lezioni, { giorni = null, oggi }) {
  return lezioni
    .filter((l) => l.event_id === evento.id && l.status === "active" && l.date >= oggi)
    .filter((l) => !giorni || giorni.includes(getDayOfWeekFromDate(l.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Se la lezione, così com'è, si discosta dal modello del suo evento. */
export function divergeDalModello(lezione, modello) {
  return hhmm(lezione.start_time) !== hhmm(modello.start_time)
    || hhmm(lezione.end_time) !== hhmm(modello.end_time)
    || lezione.room_id !== modello.room_id
    || Number(lezione.capacity) !== Number(modello.capacity);
}

/**
 * Cosa scrivere su ciascuna lezione, e quali non si possono cambiare.
 *
 * Una lezione non si cambia se finirebbe in una sala annullata o sospesa quel giorno, sopra
 * un'altra lezione nella stessa sala o con lo stesso istruttore, con l'inizio dopo la fine
 * (una serie a cui si sposta solo l'inizio può averne una che finiva prima), o con meno posti
 * dei soci già confermati.
 *
 * `modified_manually` dice se la lezione, dopo, sarà diversa dal modello del suo evento: è
 * quello che il riepilogo mostra come "modificata a parte".
 *
 * @param lezioni  le lezioni da modificare
 * @param cambi    i campi cambiati (`campiCambiati`)
 * @param modello  come sarà il modello dell'evento dopo la modifica: { room_id, start_time, end_time, capacity }
 * @param contesto { sessions, events, courses, rooms, bookings, corso } — `corso` è quello dopo la modifica
 * @returns {{ daScrivere: {lezione, dati}[], problemi: {lezione, messaggio}[], daSegnare: object[] }}
 *   `daSegnare`: lezioni lasciate com'erano che, cambiando il modello, se ne discostano.
 */
export function pianificaModifica(lezioni, cambi, modello, { sessions, events, courses, rooms, bookings, corso }) {
  const suLezione = scegli(cambi, CAMPI_LEZIONE);
  const spostata = ["date", "room_id", "start_time", "end_time", "course_id"].some((c) => c in cambi);
  const daScrivere = [];
  const problemi = [];
  const daSegnare = [];

  for (const lezione of lezioni) {
    const dopo = { ...lezione, ...suLezione };
    const problema = (() => {
      if (hhmm(dopo.start_time) >= hhmm(dopo.end_time)) {
        return `${dataBreve(dopo.date)}: l'inizio (${hhmm(dopo.start_time)}) verrebbe dopo la fine (${hhmm(dopo.end_time)}).`;
      }
      if ("room_id" in cambi || "date" in cambi) {
        const motivo = motivoSalaNonPrenotabile(rooms.find((r) => r.id === dopo.room_id), dopo.date, dopo.date);
        if (motivo) return `${dataBreve(dopo.date)}: ${motivo}`;
      }
      if (spostata) {
        const conflitto = checkSessionConflict(
          { ...lezione, date: dopo.date },
          { start_time: dopo.start_time, end_time: dopo.end_time, room_id: dopo.room_id },
          corso, sessions, events, courses,
        );
        if (conflitto.conflict) return conflitto.message;
      }
      if ("capacity" in cambi) {
        const confermati = bookings.filter((b) => b.session_id === lezione.id && b.status === "confirmed").length;
        if (cambi.capacity < confermati) {
          return `${dataBreve(dopo.date)}: ${confermati} soci già confermati, la capienza non può scendere a ${cambi.capacity}.`;
        }
      }
      return null;
    })();

    if (problema) {
      problemi.push({ lezione, messaggio: problema });
      if (!lezione.modified_manually && divergeDalModello(lezione, modello)) daSegnare.push(lezione);
      continue;
    }
    const modificata = divergeDalModello(dopo, modello);
    if (Object.keys(suLezione).length === 0 && modificata === Boolean(lezione.modified_manually)) continue;
    daScrivere.push({ lezione, dati: { ...suLezione, modified_manually: modificata } });
  }

  return { daScrivere, problemi, daSegnare };
}
