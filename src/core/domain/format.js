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

// Le date le scrive `Intl`, che è nel linguaggio: niente libreria.
//
// Prima c'era moment, e il motivo per toglierlo non è la moda — è il peso. Si portava via
// 125 kB compressi, scaricati da ogni socio che apre il portale dal telefono, per fare un
// lavoro che il browser sa già fare. `Intl.DateTimeFormat` conosce l'italiano meglio di
// qualunque tabella che potremmo scrivere noi, ed esiste ovunque: nei browser, in Node,
// su React Native.
//
// Il prezzo è che Intl non parla di "pattern": non gli si dice `dddd D MMMM`, gli si
// chiedono i pezzi — giorno della settimana, giorno, mese — e li si mette in fila. È quello
// che fa `pezziData` qui sotto, ed è anche il motivo per cui i formati ammessi restano un
// elenco chiuso invece di stringhe libere.

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
  // Senza una cifra non è un importo, è un'altra cosa. Prima si arrivava a `Number("")`,
  // che fa **zero**: scrivere "ciao" in un campo importo dava zero euro invece di un
  // errore, e zero è un valore plausibile che nessuno va a ricontrollare.
  if (!/\d/.test(pulito)) return null;
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
  // I tre qui sotto servono alle intestazioni del calendario, che mostrano un pezzo di data
  // per volta: la colonna del giorno, il numero sotto, e l'intervallo della settimana.
  giornoMeseLungo: "D MMMM",
  giornoNumero: "D",
  settimanaBreve: "ddd",
};

/**
 * Da qualunque cosa a una `Date`, o null.
 *
 * **La riga che conta è quella sulle date nude.** Le scadenze arrivano dal server come
 * `YYYY-MM-DD`, e `new Date("2026-01-31")` le legge come mezzanotte **UTC**: in un fuso
 * dietro Greenwich diventano il 30, cioè ogni abbonamento scade un giorno prima. Una
 * scadenza è un giorno sul calendario, non un istante, quindi qui la si costruisce come
 * data locale — che è quello che faceva moment, ed è il comportamento da conservare.
 */
function aData(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "string") {
    const soloGiorno = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (soloGiorno) {
      const [, anno, mese, giorno] = soloGiorno;
      return new Date(Number(anno), Number(mese) - 1, Number(giorno));
    }
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// I formattatori si costruiscono una volta sola: crearne uno nuovo a ogni data costa più
// del formattare, e queste funzioni girano dentro liste lunghe.
const formattatori = new Map();
function pezziData(data, opzioni) {
  const chiave = JSON.stringify(opzioni);
  let f = formattatori.get(chiave);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, opzioni);
    formattatori.set(chiave, f);
  }
  return Object.fromEntries(f.formatToParts(data).map((p) => [p.type, p.value]));
}

// Ogni formato è una funzione che mette in fila i pezzi che Intl restituisce. Sembra più
// verboso di `"dddd D MMMM YYYY"`, e in cambio i nomi di giorni e mesi li conosce il
// linguaggio: non c'è una tabella di traduzioni da tenere aggiornata, e cambiare lingua un
// domani è cambiare `LOCALE`.
const COSTRUTTORI = {
  breve: (d) => {
    const p = pezziData(d, { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${p.day}/${p.month}/${p.year}`;
  },
  media: (d) => {
    const p = pezziData(d, { day: "numeric", month: "short", year: "numeric" });
    return `${p.day} ${senzaPunto(p.month)} ${p.year}`;
  },
  estesa: (d) => {
    const p = pezziData(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  },
  estesaBreve: (d) => {
    const p = pezziData(d, { weekday: "long", day: "numeric", month: "long" });
    return `${p.weekday} ${p.day} ${p.month}`;
  },
  giorno: (d) => {
    const p = pezziData(d, { weekday: "short", day: "numeric", month: "short" });
    return `${senzaPunto(p.weekday)} ${p.day} ${senzaPunto(p.month)}`;
  },
  giornoBreve: (d) => {
    const p = pezziData(d, { day: "numeric", month: "short" });
    return `${p.day} ${senzaPunto(p.month)}`;
  },
  giornoMese: (d) => {
    const p = pezziData(d, { day: "2-digit", month: "2-digit" });
    return `${p.day}/${p.month}`;
  },
  mese: (d) => {
    const p = pezziData(d, { month: "long", year: "numeric" });
    return `${p.month} ${p.year}`;
  },
  // Non passa da Intl: è la forma che il server si aspetta, e deve restare il giorno
  // locale — lo stesso che l'utente vede a schermo, non quello UTC.
  iso: (d) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`,
  giornoMeseLungo: (d) => {
    const p = pezziData(d, { day: "numeric", month: "long" });
    return `${p.day} ${p.month}`;
  },
  giornoNumero: (d) => pezziData(d, { day: "numeric" }).day,
  settimanaBreve: (d) => senzaPunto(pezziData(d, { weekday: "short" }).weekday),
};

// In italiano Intl abbrevia i mesi con il punto ("gen."), moment senza. Toglierlo mantiene
// le schermate come sono sempre state, ed evita "sab. 31 gen." che sembra un refuso.
const senzaPunto = (s) => String(s).replace(/\.$/, "");
const due = (n) => String(n).padStart(2, "0");

function oraDi(data, { secondi = false } = {}) {
  const p = pezziData(data, {
    hour: "2-digit",
    minute: "2-digit",
    ...(secondi ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  });
  return secondi ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

/**
 * Data localizzata.
 * @param formato chiave di FORMATI_DATA.
 * @param ora aggiunge l'orario in coda, qualunque sia il formato scelto.
 */
export function formatData(value, formato = "breve", { vuoto = PLACEHOLDER, ora = false } = {}) {
  const d = aData(value);
  if (!d) return vuoto;
  const costruisci = COSTRUTTORI[formato] ?? COSTRUTTORI.breve;
  const testo = costruisci(d);
  return ora ? `${testo} ${oraDi(d)}` : testo;
}

/** Data e ora: 31/01/2026 14:30. */
export function formatDataOra(value, { vuoto = PLACEHOLDER, secondi = false } = {}) {
  const d = aData(value);
  if (!d) return vuoto;
  return `${COSTRUTTORI.breve(d)} ${oraDi(d, { secondi })}`;
}

/** Solo l'ora: 14:30. */
export function formatOra(value, { vuoto = PLACEHOLDER } = {}) {
  const d = aData(value);
  return d ? oraDi(d) : vuoto;
}

/** Mese e anno per intero: "gennaio 2026". */
export function formatMeseAnno(value, { vuoto = PLACEHOLDER } = {}) {
  const d = aData(value);
  return d ? COSTRUTTORI.mese(d) : vuoto;
}

/** Data in forma ISO YYYY-MM-DD, quella che il backend si aspetta. */
export function toIsoDate(value) {
  const d = aData(value);
  return d ? COSTRUTTORI.iso(d) : "";
}

/** Valore per un <input type="datetime-local">. */
export function toInputDateTime(value) {
  const d = aData(value);
  return d ? `${COSTRUTTORI.iso(d)}T${oraDi(d)}` : "";
}

// ------------------------------------------------- aritmetica dei giorni ---
//
// Quattro funzioni che prima venivano da moment (`diff`, `add`, `isSameOrAfter`) e che le
// schermate usavano per rispondere sempre alla stessa domanda: quanti giorni mancano.
//
// Si ragiona in **giorni interi sul calendario**, non in millisecondi: una scadenza è un
// giorno, e "mancano 0 giorni" a un abbonamento che scade stasera dev'essere la stessa
// risposta che si darebbe alle otto di mattina. Contare gli istanti direbbe "manca mezza
// giornata" e arrotonderebbe a zero o a uno a seconda dell'ora in cui si guarda.

const GIORNO_MS = 24 * 60 * 60 * 1000;

function aMezzanotte(value) {
  const d = aData(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Giorni fra due date, contati sul calendario. Positivo se `a` viene dopo `b`.
 * Senza il secondo argomento si conta da oggi.
 */
export function giorniTra(a, b = new Date()) {
  const primo = aMezzanotte(a);
  const secondo = aMezzanotte(b);
  if (!primo || !secondo) return null;
  // L'ora legale sposta un giorno di un'ora: senza arrotondare, due date a 24 giorni di
  // distanza che attraversano il cambio darebbero 23,96 e quindi 23.
  return Math.round((primo - secondo) / GIORNO_MS);
}

/** Quanti giorni mancano a una data. Negativo se è passata. */
export function giorniAllaData(value) {
  return giorniTra(value);
}

/** La stessa data spostata di N giorni (negativi per andare indietro). */
export function aggiungiGiorni(value, giorni) {
  const d = aMezzanotte(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + giorni);
}

/** Vera se `a` cade nello stesso giorno di `b` o dopo. */
export function stessoGiornoOdopo(a, b = new Date()) {
  const giorni = giorniTra(a, b);
  return giorni !== null && giorni >= 0;
}
