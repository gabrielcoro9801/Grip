// I conti sui contatti: quanti ne arrivano, quando, da dove, di chi.
//
// Stanno in `shared/` come le altre regole di dominio, e sono funzioni pure: la pagina
// "Andamento" scarica i lead e li conta qui, e i test le provano con `node --test`.
//
// Le date sono stringhe `AAAA-MM-GG`, come arrivano dall'API: anno e mese si leggono dal testo,
// senza passare per `Date` e per i fusi orari.

export const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

const annoDi = (data) => (data ? Number(String(data).slice(0, 4)) : null);
const meseDi = (data) => (data ? Number(String(data).slice(5, 7)) : null);

/**
 * I lead che rispettano i filtri. Un filtro assente, o vuoto, non filtra. Il mese va da 1 a 12.
 *
 * @param {Array<Object>} leads
 * @param {{ anno?: number|string|null, mese?: number|string|null, sesso?: string|null, annoNascita?: number|string|null, canaleId?: string|null }} [filtri]
 */
export function filtraContatti(leads = [], { anno, mese, sesso, annoNascita, canaleId } = {}) {
  const c = (v) => v !== undefined && v !== null && v !== "";
  return leads.filter((l) =>
    (!c(anno) || annoDi(l.data_contatto) === Number(anno))
    && (!c(mese) || meseDi(l.data_contatto) === Number(mese))
    && (!c(sesso) || l.sesso === sesso)
    && (!c(annoNascita) || l.anno_nascita === Number(annoNascita))
    && (!c(canaleId) || l.canale_id === canaleId)
  );
}

/**
 * Quanti lead per valore di un campo, dal più frequente.
 * I lead senza quel dato (es. anno di nascita non indicato) finiscono sotto `null`.
 */
export function contaPer(leads = [], campo) {
  const conti = new Map();
  for (const l of leads) {
    const chiave = l[campo] ?? null;
    conti.set(chiave, (conti.get(chiave) ?? 0) + 1);
  }
  return [...conti.entries()]
    .map(([valore, totale]) => ({ valore, totale }))
    .sort((a, b) => b.totale - a.totale);
}

/** I dodici mesi di un anno, anche quelli senza contatti: un mese a zero è un dato. */
export function contattiPerMese(leads = [], anno) {
  const conti = Array(12).fill(0);
  for (const l of leads) {
    if (annoDi(l.data_contatto) !== Number(anno)) continue;
    const m = meseDi(l.data_contatto);
    if (m >= 1 && m <= 12) conti[m - 1] += 1;
  }
  return conti.map((totale, i) => ({ mese: i + 1, etichetta: MESI[i], totale }));
}

const valoriDistinti = (valori) => [...new Set(valori.filter((v) => v !== null && !Number.isNaN(v)))].sort((a, b) => b - a);

/** Gli anni in cui ci sono contatti, dal più recente: sono le voci del filtro. */
export function anniDisponibili(leads = []) {
  return valoriDistinti(leads.map((l) => annoDi(l.data_contatto)));
}

/** Gli anni di nascita presenti, dal più recente. */
export function anniNascitaDisponibili(leads = []) {
  return valoriDistinti(leads.map((l) => l.anno_nascita ?? null));
}
