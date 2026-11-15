// Le regole dei corsi che servono sia al server sia alle schermate.
import { oggiIso, oraIso, istanteRoma } from './giorni.js';

/** Le note di un corso stanno in tre righe della sua tile nel catalogo. */
export const NOTE_CORSO_MASSIMO = 140;

/**
 * Come si ripete un evento: una data sola, o una regola settimanale.
 *
 * Le date personalizzate non si creano più. Gli eventi fatti così prima restano validi e si
 * modificano, ma un evento nuovo è l'uno o l'altro.
 */
export const RICORRENZE_CREABILI = ['single', 'weekly'];

/** I giorni in cui si ripete una sessione (`events.giorno`), da lunedì: uno per sessione. */
export const GIORNI_SETTIMANA = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Il termine di disdetta più lungo che si può impostare su un corso: una settimana. */
export const DISDETTA_MASSIMA_ORE = 168;

/**
 * Fino a quando un socio può disdire una lezione: l'inizio meno le ore del corso, come data e
 * ora di Roma ({ data: 'AAAA-MM-GG', ora: 'HH:MM' }). Null se il corso non ha un termine: allora
 * si disdice fino alla fine della lezione, come sempre.
 *
 * Il conto si fa sull'orologio da parete (data e ora come stringhe, in UTC per non avere l'ora
 * legale di mezzo): "due ore prima delle 18" sono le 16, anche il giorno del cambio d'ora.
 */
export function limiteDisdetta(lezione, ore) {
  if (ore === null || ore === undefined || ore === '') return null;
  const inizio = String(lezione?.start_time ?? lezione?.startTime ?? '').slice(0, 5);
  const ms = Date.parse(`${String(lezione?.date ?? '').slice(0, 10)}T${inizio}:00Z`);
  if (Number.isNaN(ms)) return null;
  const limite = new Date(ms - Number(ore) * 3_600_000).toISOString();
  return { data: limite.slice(0, 10), ora: limite.slice(11, 16) };
}

/** Perché il socio non può più disdire da sé, o null. Lo staff disdice sempre. */
export function motivoDisdettaChiusa(lezione, ore, adesso = new Date()) {
  const limite = limiteDisdetta(lezione, ore);
  if (!limite) return null;
  if (`${oggiIso(adesso)}T${oraIso(adesso)}` < `${limite.data}T${limite.ora}`) return null;
  const quanto = Number(ore) === 0 ? "fino all'inizio della lezione" : `fino a ${ore} ${Number(ore) === 1 ? 'ora' : 'ore'} prima dell'inizio`;
  return `Questa lezione si disdice ${quanto}: per disdire adesso rivolgiti alla reception.`;
}

// --- La lista d'attesa e il ripensamento (docs/piani/portale.md, D-3) ----------------------

/** Per quanto un posto liberato resta offerto al primo in lista, prima di passare al successivo. */
export const ORE_OFFERTA_POSTO = 12;

/**
 * Il socio disdice sempre una prenotazione fatta da meno di tanti minuti, anche oltre il termine:
 * è il tempo dell'«Annulla» dopo un tocco sbagliato.
 */
export const MARGINE_RIPENSAMENTO_MINUTI = 10;

/**
 * Quando si chiude la lista d'attesa di una lezione, come istante: al termine di disdetta del
 * corso (deciso corso per corso, 14/11) o, se il corso non ne ha, all'inizio della lezione. Da lì
 * nessuna offerta nuova e nessun nuovo in attesa: il posto che si libera è di chi lo prende.
 */
export function chiusuraLista(lezione, ore) {
  const limite = limiteDisdetta(lezione, ore);
  if (limite) return istanteRoma(limite.data, limite.ora);
  return istanteRoma(String(lezione?.date ?? '').slice(0, 10), String(lezione?.start_time ?? lezione?.startTime ?? '').slice(0, 5));
}

/** La fascia della giornata di un orario «HH:MM»: prima delle 13 mattino, dalle 18 sera. */
export function fasciaDelGiorno(ora) {
  const hh = String(ora ?? '').slice(0, 5);
  if (hh < '13:00') return 'mattino';
  if (hh < '18:00') return 'pomeriggio';
  return 'sera';
}
