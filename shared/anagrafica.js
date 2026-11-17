// Le regole dell'anagrafica, dei soci, per il server e per le schermate.
//
// Il codice fiscale sta qui e non in un modulo: la segreteria lo scrive a mano, e un
// carattere sbagliato non si nota finché non serve — al tesseramento, su una ricevuta. Il
// controllo va fatto mentre lo si digita (schermate) e di nuovo quando arriva (server): con
// due copie della regola, prima o poi una delle due accetterebbe un codice che l'altra rifiuta.
import { oggiIso, eUnGiorno } from "./giorni.js";

export const SESSI = [
  { valore: "M", etichetta: "Maschio" },
  { valore: "F", etichetta: "Femmina" },
  { valore: "altro", etichetta: "Altro" },
];

const ETICHETTE_SESSO = Object.fromEntries(SESSI.map((s) => [s.valore, s.etichetta]));

export const sessoValido = (v) => v in ETICHETTE_SESSO;
export const etichettaSesso = (v) => ETICHETTE_SESSO[v] ?? "";

/**
 * "Mario" + "Rossi" → "Mario Rossi", come lo calcola il database per `members.full_name`.
 * @param {{ nome?: string, cognome?: string }} [persona]
 */
export function nomeCompleto({ nome, cognome } = {}) {
  return `${nome ?? ""} ${cognome ?? ""}`.trim();
}

// ---------------------------------------------------------------------------------------
// Data di nascita ed età
// ---------------------------------------------------------------------------------------

/** Da quando un socio è maggiorenne. */
export const MAGGIORE_ETA = 18;

/**
 * Perché una data di nascita non va bene, o null.
 *
 * È obbligatoria per ogni socio: da lei dipende se è minorenne, e quindi se servono il consenso
 * dei genitori e chi firma per lui.
 */
export function motivoDataNascitaNonValida(data, oggi = oggiIso()) {
  if (data === undefined || data === null || String(data).trim() === "") return "La data di nascita è obbligatoria.";
  const giorno = String(data).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || !eUnGiorno(giorno)) return "La data di nascita non è valida.";
  if (giorno > oggi) return "La data di nascita non può essere nel futuro.";
  if (giorno < "1900-01-01") return "La data di nascita non può essere prima del 1900.";
  return null;
}

/**
 * Gli anni compiuti a `oggi`, o null senza una data valida.
 *
 * Il conto si fa sulle stringhe `AAAA-MM-GG`, senza passare per `Date`: un compleanno è un
 * giorno del calendario, e a mezzanotte in Italia `Date` in UTC è ancora il giorno prima.
 * Chi è nato il 29 febbraio compie gli anni il 1° marzo negli anni non bisestili.
 */
export function etaA(dataNascita, oggi = oggiIso()) {
  const nascita = String(dataNascita ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascita) || !eUnGiorno(nascita)) return null;
  const anni = Number(oggi.slice(0, 4)) - Number(nascita.slice(0, 4));
  return oggi.slice(5) < nascita.slice(5) ? anni - 1 : anni;
}

/** Se chi è nato in quella data oggi è minorenne. Senza data non lo si sa: false. */
export function eMinorenne(dataNascita, oggi = oggiIso()) {
  const anni = etaA(dataNascita, oggi);
  return anni !== null && anni < MAGGIORE_ETA;
}

/**
 * Se a un socio manca il consenso dei genitori firmato: è minorenne e la spunta «firmato» non c'è.
 * Era un documento caricato; da novembre 2026 è una spunta in anagrafica (decisione R4,
 * docs/piani/portale.md). Non blocca niente: la scheda lo segnala.
 * @param socio { date_of_birth, consenso_genitori_firmato }
 */
export function consensoGenitoriDaFirmare(socio, oggi = oggiIso()) {
  return eMinorenne(socio?.date_of_birth, oggi) && !socio?.consenso_genitori_firmato;
}

// ---------------------------------------------------------------------------------------
// Codice fiscale
// ---------------------------------------------------------------------------------------

/** Maiuscolo e senza spazi: "rss mra 85t10 a562s" → "RSSMRA85T10A562S". */
export function normalizzaCodiceFiscale(valore) {
  return String(valore ?? "").replace(/\s+/g, "").toUpperCase();
}

// Cognome (3) nome (3) anno (2) mese (1) giorno (2) comune (4) controllo (1). Le cifre possono
// essere sostituite da lettere (L M N P Q R S T U V): è l'omocodia, che l'Agenzia delle Entrate
// usa quando due persone avrebbero lo stesso codice.
const FORMATO = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

// Valore dei caratteri in posizione dispari (1ª, 3ª, …), per cifre e lettere allo stesso modo.
const DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];

function valore(carattere) {
  const codice = carattere.charCodeAt(0);
  return codice <= 57 ? codice - 48 : codice - 65; // "0"-"9" → 0-9, "A"-"Z" → 0-25
}

/** Il carattere di controllo atteso per i primi 15 caratteri. */
export function carattereDiControllo(primi15) {
  let somma = 0;
  for (let i = 0; i < 15; i += 1) {
    const v = valore(primi15[i]);
    somma += i % 2 === 0 ? DISPARI[v] : v;
  }
  return String.fromCharCode(65 + (somma % 26));
}

/**
 * Se il codice fiscale è scritto bene: forma e carattere di controllo.
 *
 * Non dice che il codice esista né che corrisponda a nome e data di nascita — per quello
 * servirebbe l'Agenzia delle Entrate. Prende però l'errore di battitura, che è quello che
 * capita davvero.
 */
export function codiceFiscaleValido(valoreGrezzo) {
  const cf = normalizzaCodiceFiscale(valoreGrezzo);
  if (!FORMATO.test(cf)) return false;
  return carattereDiControllo(cf.slice(0, 15)) === cf[15];
}

// ---------------------------------------------------------------------------------------
// Partita IVA
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// Telefono
// ---------------------------------------------------------------------------------------

/**
 * Il numero nel formato internazionale (E.164): "333 123 4567" → "+393331234567", o null se
 * non è un numero.
 *
 * Un numero scritto ogni volta in modo diverso ("333.1234567", "+39 333…", "0039…") non si
 * ritrova cercandolo, non dice che due contatti sono la stessa persona, e non apre WhatsApp
 * né riceve un SMS. Senza prefisso si intende italiano: cellulari (3…) e fissi (0…). Uno con
 * il prefisso si tiene com'è, purché abbia le cifre di un numero vero.
 *
 * La stessa regola è scritta in SQL nella migrazione 0051, che ha sistemato i numeri già salvati.
 */
export function normalizzaTelefono(valore) {
  const grezzo = String(valore ?? "").trim();
  if (!grezzo || /[^\d\s+()./-]/.test(grezzo)) return null;
  let cifre = grezzo.replace(/[^\d+]/g, "");
  if (cifre.startsWith("00")) cifre = `+${cifre.slice(2)}`;
  if (cifre.lastIndexOf("+") > 0) return null;
  if (cifre.startsWith("+")) return /^\+[1-9]\d{6,14}$/.test(cifre) ? cifre : null;
  if (/^(3\d{8,9}|0\d{5,10})$/.test(cifre)) return `+39${cifre}`;
  if (/^39(3\d{8,9}|0\d{5,10})$/.test(cifre)) return `+${cifre}`;
  return null;
}

/** Il link che apre una chat WhatsApp col numero, e il testo già scritto se c'è; null senza numero. */
export function linkWhatsApp(telefono, testo) {
  const numero = normalizzaTelefono(telefono);
  if (!numero) return null;
  return `https://wa.me/${numero.slice(1)}${testo ? `?text=${encodeURIComponent(testo)}` : ""}`;
}

/** Le note di un istruttore stanno in tre righe della sua tile. */
export const NOTE_ISTRUTTORE_MASSIMO = 140;

/** Le note della segreteria su un socio: due righe, come quelle di un contatto o di un corso. */
export const NOTE_SOCIO_MASSIMO = 140;

/** Solo le cifre, senza spazi né prefisso "IT": "IT 012 345 67890" → "01234567890". */
export function normalizzaPartitaIva(valore) {
  return String(valore ?? "").replace(/\s+/g, "").toUpperCase().replace(/^IT/, "");
}

/**
 * Se la partita IVA è scritta bene: undici cifre, e l'ultima è quella di controllo.
 *
 * Come per il codice fiscale, non dice che esista: prende l'errore di battitura.
 */
export function partitaIvaValida(valoreGrezzo) {
  const piva = normalizzaPartitaIva(valoreGrezzo);
  if (!/^\d{11}$/.test(piva)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i += 1) {
    const cifra = Number(piva[i]);
    if (i % 2 === 0) somma += cifra;
    else somma += cifra * 2 > 9 ? cifra * 2 - 9 : cifra * 2;
  }
  return (10 - (somma % 10)) % 10 === Number(piva[10]);
}
