// Le regole dell'anagrafica, uguali per soci e lead, per il server e per le schermate.
//
// Il codice fiscale sta qui e non in un modulo: la segreteria lo scrive a mano, e un
// carattere sbagliato non si nota finché non serve — al tesseramento, su una ricevuta. Il
// controllo va fatto mentre lo si digita (schermate) e di nuovo quando arriva (server): con
// due copie della regola, prima o poi una delle due accetterebbe un codice che l'altra rifiuta.

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
// Documenti del socio
// ---------------------------------------------------------------------------------------

/**
 * I tipi di documento.
 *
 * `atteso` dice che la scheda del socio segnala quando manca: il certificato medico serve per
 * allenarsi, il documento di identità per il tesseramento. Gli altri si caricano se servono.
 * `scadenza` dice se la data di scadenza è obbligatoria: certificato e documento di identità
 * scadono entrambi, e senza la data la scheda non sa dire quando il socio va richiamato.
 */
export const TIPI_DOCUMENTO = [
  { valore: "certificato_medico", etichetta: "Certificato medico", atteso: true, scadenza: true },
  { valore: "documento_identita", etichetta: "Documento di identità", atteso: true, scadenza: true },
  { valore: "altro", etichetta: "Altri documenti", atteso: false, scadenza: false },
];

const PER_TIPO = Object.fromEntries(TIPI_DOCUMENTO.map((t) => [t.valore, t]));

export const tipoDocumentoValido = (v) => v in PER_TIPO;
export const infoTipoDocumento = (v) => PER_TIPO[v] ?? null;

/** Come chiamare un documento: il titolo per gli "altri", altrimenti il tipo. */
export function nomeDocumento(doc) {
  if (doc?.document_type === "altro") return doc.titolo || "Documento";
  return PER_TIPO[doc?.document_type]?.etichetta ?? doc?.document_type ?? "";
}

/** Perché un documento non si può salvare, o null. */
export function motivoDocumentoNonValido(doc) {
  const tipo = PER_TIPO[doc?.document_type];
  if (!tipo) return "Tipo di documento non valido.";
  if (doc.document_type === "altro" && !String(doc.titolo ?? "").trim()) return "Indica di che documento si tratta.";
  if (tipo.scadenza && !doc.expiry_date) return `${tipo.etichetta}: indica la data di scadenza.`;
  return null;
}
