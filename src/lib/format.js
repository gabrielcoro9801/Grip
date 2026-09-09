// Punto unico per scrivere importi, numeri e date nell'interfaccia.
//
// Prima di questo modulo la stessa cifra si leggeva "1234.50" in una pagina e
// "1.234,50" in quella accanto, e la stessa data usava dodici formati moment
// diversi (alcuni in inglese, perché il locale non era mai stato impostato).
// Qui la convenzione è una sola: italiano, fuso Europe/Rome, euro con il
// separatore delle migliaia e la virgola decimale.
//
// I calcoli restano fuori: formatta, non somma. Per sommare denaro usare
// `arrotonda`/`sommaImporti`, che passano dai centesimi interi ed evitano che
// 0.1 + 0.2 diventi 0.30000000000000004 in una prima nota.

import moment from "moment";
import "moment/locale/it";

// Importare questo modulo basta a mettere moment in italiano ovunque: i file
// che chiamano moment(...).format("ddd D MMM") direttamente ne beneficiano.
moment.locale("it");

export const LOCALE = "it-IT";
export const TIMEZONE = "Europe/Rome";
export const VALUTA = "EUR";

const PLACEHOLDER = "—";

const euroFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: VALUTA,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numeroFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Numero utilizzabile, oppure null se il valore non è interpretabile. */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- denaro ---

/**
 * Arrotonda a due decimali passando per i centesimi interi.
 * `Math.round(v * 100)` da solo sbaglia su valori come 1.005 (che in binario è
 * poco sotto), quindi si corregge con un epsilon proporzionale.
 */
export function arrotonda(value) {
  const n = toNumber(value);
  if (n === null) return 0;
  return centesimi(n) / 100;
}

/** Importo in euro → centesimi interi, l'unità in cui il denaro si somma. */
export function centesimi(value) {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.round(n * 100 + (n >= 0 ? Number.EPSILON : -Number.EPSILON) * 100);
}

/** Centesimi interi → euro. */
export function daCentesimi(cents) {
  const n = toNumber(cents);
  if (n === null) return 0;
  return Math.round(n) / 100;
}

/** Somma di importi senza deriva binaria: si somma in centesimi e si torna in euro. */
export function sommaImporti(values) {
  const totale = (values || []).reduce((acc, v) => acc + centesimi(v), 0);
  return daCentesimi(totale);
}

/** true se due importi sono lo stesso denaro (confronto al centesimo). */
export function stessoImporto(a, b) {
  return centesimi(a) === centesimi(b);
}

/**
 * Importo in euro come lo scrive un'app italiana: 1.234,50 €.
 * - `vuoto`: cosa rendere quando il valore manca (default "—").
 * - `segno`: antepone "+" agli importi positivi (utile in prima nota).
 */
export function formatEuro(value, { vuoto = PLACEHOLDER, segno = false } = {}) {
  const n = toNumber(value);
  if (n === null) return vuoto;
  const testo = euroFormatter.format(arrotonda(n));
  return segno && n > 0 ? `+${testo}` : testo;
}

/** Come formatEuro ma con "+"/"−" espliciti: per entrate e uscite affiancate. */
export function formatEuroSegnato(value, opzioni = {}) {
  const n = toNumber(value);
  if (n === null) return opzioni.vuoto ?? PLACEHOLDER;
  if (n < 0) return `−${euroFormatter.format(Math.abs(arrotonda(n)))}`;
  return formatEuro(n, { ...opzioni, segno: true });
}

/** Numero decimale localizzato, senza simbolo di valuta. */
export function formatNumero(value, { vuoto = PLACEHOLDER, decimali = 2 } = {}) {
  const n = toNumber(value);
  if (n === null) return vuoto;
  if (decimali === 2) return numeroFormatter.format(n);
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimali,
    maximumFractionDigits: decimali,
  }).format(n);
}

/** Percentuale localizzata: 4.5 → "4,5%". */
export function formatPercentuale(value, { vuoto = PLACEHOLDER, decimali = 2 } = {}) {
  const n = toNumber(value);
  if (n === null) return vuoto;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: decimali }).format(n)}%`;
}

/**
 * Testo digitato dall'utente → numero. Accetta sia "1.234,50" (italiano) sia
 * "1234.50" (quello che arrivano dai campi <input type="number">).
 */
export function parseImporto(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (!input) return null;
  const pulito = String(input).replace(/[^\d,.-]/g, "");
  // Se ci sono entrambi, l'ultimo separatore è quello decimale.
  const ultimaVirgola = pulito.lastIndexOf(",");
  const ultimoPunto = pulito.lastIndexOf(".");
  let normalizzato = pulito;
  if (ultimaVirgola > -1 && ultimaVirgola > ultimoPunto) {
    normalizzato = pulito.replace(/\./g, "").replace(",", ".");
  } else if (ultimaVirgola > -1) {
    normalizzato = pulito.replace(/,/g, "");
  }
  const n = Number(normalizzato);
  return Number.isFinite(n) ? n : null;
}

/**
 * Numero per un file destinato a una macchina (CSV, tracciati, API): punto
 * decimale e nessun separatore di migliaia. Non usarlo a schermo.
 */
export function toCsvNumber(value) {
  const n = toNumber(value);
  return (n === null ? 0 : arrotonda(n)).toFixed(2);
}

// ------------------------------------------------------------------ date ---

/**
 * I modi ammessi di scrivere una data. Erano dodici e più, per la stessa
 * informazione, con dentro anche formati americani ("MMM D, YYYY") in un
 * gestionale italiano.
 */
export const FORMATI_DATA = {
  breve: "DD/MM/YYYY",
  media: "D MMM YYYY",
  estesa: "dddd D MMMM YYYY",
  estesaBreve: "dddd D MMMM",
  giorno: "ddd D MMM",
  giornoBreve: "D MMM",
  giornoMese: "DD/MM",
  mese: "MMMM YYYY",
  iso: "YYYY-MM-DD",
};

/**
 * Le date "solo giorno" arrivano dal backend come stringa YYYY-MM-DD.
 * `new Date("2026-01-31")` le legge come mezzanotte UTC e in Europe/Rome
 * possono retrocedere al giorno prima: moment sulla stringa nuda le tratta
 * invece come data locale, che è il comportamento voluto.
 */
function toMoment(value) {
  if (value === null || value === undefined || value === "") return null;
  const m = moment(value);
  return m.isValid() ? m : null;
}

/**
 * Data localizzata.
 * @param formato chiave di FORMATI_DATA (o, per i casi davvero unici, un
 *   pattern moment).
 * @param ora aggiunge l'orario in coda, qualunque sia il formato scelto.
 */
export function formatData(value, formato = "breve", { vuoto = PLACEHOLDER, ora = false } = {}) {
  const m = toMoment(value);
  if (!m) return vuoto;
  const pattern = FORMATI_DATA[formato] || formato;
  return m.format(ora ? `${pattern} HH:mm` : pattern);
}

/** Data e ora: 31/01/2026 14:30. */
export function formatDataOra(value, { vuoto = PLACEHOLDER, secondi = false } = {}) {
  const m = toMoment(value);
  if (!m) return vuoto;
  return m.format(secondi ? "DD/MM/YYYY HH:mm:ss" : "DD/MM/YYYY HH:mm");
}

/** Solo l'ora: 14:30. */
export function formatOra(value, { vuoto = PLACEHOLDER } = {}) {
  const m = toMoment(value);
  if (!m) return vuoto;
  return m.format("HH:mm");
}

/** Mese e anno per intero: "gennaio 2026". */
export function formatMeseAnno(value, { vuoto = PLACEHOLDER } = {}) {
  const m = toMoment(value);
  if (!m) return vuoto;
  return m.format(FORMATI_DATA.mese);
}

/** Data in forma ISO YYYY-MM-DD, quella che il backend si aspetta. */
export function toIsoDate(value) {
  const m = toMoment(value);
  return m ? m.format(FORMATI_DATA.iso) : "";
}

/** Valore per un <input type="datetime-local">. */
export function toInputDateTime(value) {
  const m = toMoment(value);
  return m ? m.format("YYYY-MM-DDTHH:mm") : "";
}
