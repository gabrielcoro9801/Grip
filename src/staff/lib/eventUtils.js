// Import relativi con l'estensione, e non con `@/`: così il file si carica anche con
// `node --test`, e le date che genera si possono provare nel fuso vero (eventUtils.test.js).
//
// Le sovrapposizioni di sala e istruttore non si contano più qui: le conta il server
// (POST /api/calendario/conflitti), che vede tutto il calendario. Prima la regola voleva tutte le
// lezioni in memoria nel browser.
import { toIsoDate } from "../../core/domain/format.js";

const DAY_MAP = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0 };

// Il tetto del ciclo: oltre, una data fine sbagliata di un secolo bloccherebbe la pagina.
const MASSIMO_LEZIONI = 1000;

/**
 * Le date delle lezioni di una sessione, o di una lezione singola.
 * - single: una sola data (start_date)
 * - weekly: ogni settimana nel suo giorno (`giorno`, 'Monday'…'Sunday'), da start_date
 *   - by_date: fino a end_date
 *   - by_count: per occurrence_count lezioni
 * - custom: le date esplicite in custom_dates (le vecchie sessioni a date scelte)
 *
 * Una sessione si ripete in un giorno solo: due giorni sono due sessioni (migrazione 0059).
 */
export function generateSessionDates(event) {
  if (event.recurrence_type === "single") {
    return [event.start_date];
  }

  if (event.recurrence_type === "custom") {
    return [...(event.custom_dates || [])].sort();
  }

  // weekly
  const giorno = DAY_MAP[event.giorno];
  if (giorno === undefined || !event.start_date) return [];

  // Il ciclo cammina sulle mezzanotti *locali*, quindi anche la data va letta nei campi
  // locali (`toIsoDate`). Con `toISOString()` usciva in UTC, che in Italia è ancora il giorno
  // prima: un corso del lunedì veniva salvato di domenica, e il calendario del gestionale —
  // sfalsato dello stesso giorno al contrario — lo mostrava giusto, nascondendo l'errore.
  const corrente = new Date(event.start_date + "T00:00:00");
  // Dal primo giorno giusto, poi di sette in sette: `setDate` resta sulla mezzanotte locale
  // anche attraverso il cambio dell'ora.
  while (corrente.getDay() !== giorno) corrente.setDate(corrente.getDate() + 1);

  let fine = null;
  let quante = MASSIMO_LEZIONI;
  if (event.end_condition === "by_date") {
    if (!event.end_date) return [];
    fine = new Date(event.end_date + "T00:00:00");
  } else if (event.end_condition === "by_count") {
    quante = Math.min(Number(event.occurrence_count) || 0, MASSIMO_LEZIONI);
  } else {
    return [];
  }

  const dates = [];
  while (dates.length < quante && (!fine || corrente <= fine)) {
    dates.push(toIsoDate(corrente));
    corrente.setDate(corrente.getDate() + 7);
  }
  return dates;
}

/**
 * Le 42 caselle del calendario mensile (sei settimane, da lunedì), ognuna con la data che
 * mostra e la chiave `YYYY-MM-DD` con cui cercarne le lezioni.
 *
 * La chiave si legge nei campi locali: con `toISOString()` (UTC) la casella del giorno N
 * cercava le lezioni del giorno N−1, e il calendario appariva sfalsato di un giorno.
 */
export function grigliaDelMese(anno, mese) {
  const primo = new Date(anno, mese, 1);
  const dow = primo.getDay();
  const scarto = dow === 0 ? 6 : dow - 1;
  const caselle = [];
  for (let i = 0; i < 42; i++) {
    const data = new Date(anno, mese, 1 - scarto + i);
    caselle.push({ data, chiave: toIsoDate(data) });
  }
  return caselle;
}
