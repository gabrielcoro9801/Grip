// La modifica di una sessione da Sessioni: quali lezioni tocca, cosa scrivere su ciascuna, e
// quali non si possono cambiare e perché. Niente React e niente rete: la finestra chiede, questo
// modulo decide, e i test lo provano senza browser (modificaEvento.test.js).
//
// Le sovrapposizioni con le altre lezioni le conta il server (POST /api/calendario/conflitti):
// qui si preparano le domande (`richiesteConflitti`) e si leggono le risposte.
//
// Import relativi con l'estensione, come eventUtils.js: così il file si carica con `node --test`.
import { DAYS_IT } from "./courseValidation.js";
import { motivoSalaNonPrenotabile, dataIt } from "../../core/domain/sale.js";

/** "09:00:00" dal database, "09:00" dal modulo: si confrontano ore e minuti. */
export const hhmm = (t) => String(t ?? "").slice(0, 5);

/** Una sessione ha più lezioni generate da una regola; una lezione singola ne ha una. */
export const eUnaSerie = (evento) => evento?.recurrence_type === "weekly" || evento?.recurrence_type === "custom";

// I campi che stanno su ogni lezione, e quelli che la sessione tiene come modello per le sue lezioni.
const CAMPI_LEZIONE = ["date", "room_id", "start_time", "end_time", "capacity"];
export const CAMPI_MODELLO = ["room_id", "start_time", "end_time", "capacity"];

const scegli = (oggetto, campi) => Object.fromEntries(campi.filter((c) => c in oggetto).map((c) => [c, oggetto[c]]));
const dataBreve = (iso) => dataIt(iso).slice(0, 5);

/** L'ultimo giorno della sessione, o null se non è noto (settimanale a occorrenze). */
export function fineEvento(evento) {
  if (evento.recurrence_type === "weekly") return evento.end_condition === "by_date" ? evento.end_date || null : null;
  if (evento.recurrence_type === "custom") {
    const date = [...(evento.custom_dates || [])].sort();
    return date[date.length - 1] ?? evento.start_date;
  }
  return evento.start_date;
}

/** "martedì" — il giorno di una sessione, per le frasi. */
export const nomeGiorno = (giorno) => (DAYS_IT[giorno] ?? giorno ?? "").toLowerCase();

/** La regola della sessione in una riga: "Ogni martedì, dal 01/10/2026 al 20/12/2026". */
export function descriviSerie(evento) {
  if (evento.recurrence_type === "custom") return "Date scelte una per una";
  if (evento.recurrence_type !== "weekly") return "";
  const fine = evento.end_condition === "by_count"
    ? `per ${evento.occurrence_count} lezioni`
    : `al ${dataIt(evento.end_date)}`;
  return `Ogni ${nomeGiorno(evento.giorno)}, dal ${dataIt(evento.start_date)} ${fine}`;
}

/**
 * Quello che il modulo ha cambiato rispetto a com'era all'apertura, e solo quello.
 *
 * Una sessione a cui si sposta l'orario non si vede cambiare anche la sala: se una lezione era
 * stata messa a parte in un'altra stanza, ci resta. È ciò che ci si aspetta da un calendario —
 * si cambia la cosa che si è toccata.
 *
 * Il corso non c'è: in modifica non si cambia (una sessione di Pilates non diventa Yoga — si
 * elimina e se ne crea un'altra). La data fine sì: `end_date` è un cambio dell'intera sessione,
 * e lo applica il server (POST /api/calendario/eventi/:id/data-fine).
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
 * Dove finisce una sessione oggi: la data fine se c'è, altrimenti l'ultima lezione che ha in
 * calendario (una sessione contata a occorrenze). È il valore da cui parte il campo "Data fine".
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
 * Le lezioni che la modifica della sessione tocca: quelle ancora in calendario da oggi in poi.
 *
 * Il passato non si riscrive: una lezione già tenuta è andata con quell'orario e in quella sala,
 * e chi c'era era prenotato lì.
 */
export function lezioniDellaSerie(evento, lezioni, { oggi }) {
  return lezioni
    .filter((l) => l.event_id === evento.id && l.status === "active" && l.date >= oggi)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Se i cambi spostano le lezioni (giorno, sala o orario): solo allora si controllano le altre. */
export const spostaLeLezioni = (cambi) => ["date", "room_id", "start_time", "end_time"].some((c) => c in cambi);

/**
 * Le domande da fare al server sulle sovrapposizioni: una per ogni sala e orario che le lezioni
 * avranno dopo la modifica. Di solito è una sola; una lezione messa a parte in un'altra sala, a
 * cui si cambia solo l'orario, resta nella sua e fa una domanda a sé. Una lezione con l'inizio
 * dopo la fine non si chiede: la rifiuta già `pianificaModifica`.
 *
 * @returns [{ corpo: { date, start_time, end_time, room_id }, perData: Map<data, idLezione> }]
 */
export function richiesteConflitti(lezioni, cambi) {
  const suLezione = scegli(cambi, CAMPI_LEZIONE);
  const gruppi = new Map();
  for (const lezione of lezioni) {
    const dopo = { ...lezione, ...suLezione };
    if (hhmm(dopo.start_time) >= hhmm(dopo.end_time)) continue;
    const chiave = `${dopo.room_id}|${hhmm(dopo.start_time)}|${hhmm(dopo.end_time)}`;
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, {
        corpo: { date: [], start_time: hhmm(dopo.start_time), end_time: hhmm(dopo.end_time), room_id: dopo.room_id },
        perData: new Map(),
      });
    }
    const g = gruppi.get(chiave);
    g.corpo.date.push(dopo.date);
    g.perData.set(dopo.date, lezione.id);
  }
  return [...gruppi.values()];
}

/** Le risposte del server, lezione per lezione: Map<idLezione, messaggio>. */
export function conflittiPerLezione(richieste, risposte) {
  const per = new Map();
  richieste.forEach((r, i) => {
    for (const c of risposte[i]?.conflitti ?? []) {
      const id = r.perData.get(c.data);
      if (id && !per.has(id)) per.set(id, c.messaggio);
    }
  });
  return per;
}

/** Se la lezione, così com'è, si discosta dal modello della sua sessione. */
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
 * un'altra lezione nella stessa sala o con lo stesso istruttore (`conflitti`, dal server), con
 * l'inizio dopo la fine (una sessione a cui si sposta solo l'inizio può averne una che finiva
 * prima), o con meno posti dei soci già confermati (`lezione.confermati`, contati dal server).
 *
 * `modified_manually` dice se la lezione, dopo, sarà diversa dal modello della sua sessione: è
 * quello che la pagina della lezione mostra come "Orario diverso dalla sessione".
 *
 * @param lezioni  le lezioni da modificare (GET /api/calendario/lezioni, con `confermati`)
 * @param cambi    i campi cambiati (`campiCambiati`)
 * @param modello  come sarà il modello della sessione dopo la modifica: { room_id, start_time, end_time, capacity }
 * @param contesto { rooms, conflitti } — `conflitti`: Map<idLezione, messaggio> (`conflittiPerLezione`)
 * @returns {{ daScrivere: {lezione, dati}[], problemi: {lezione, messaggio}[], daSegnare: object[] }}
 *   `daSegnare`: lezioni lasciate com'erano che, cambiando il modello, se ne discostano.
 */
export function pianificaModifica(lezioni, cambi, modello, { rooms, conflitti = new Map() }) {
  const suLezione = scegli(cambi, CAMPI_LEZIONE);
  const spostata = spostaLeLezioni(cambi);
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
      if (spostata && conflitti.has(lezione.id)) return conflitti.get(lezione.id);
      if ("capacity" in cambi) {
        const confermati = Number(lezione.confermati ?? 0);
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
