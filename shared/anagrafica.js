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

// ---------------------------------------------------------------------------------------
// Lo stato di un documento, e quando finisce in archivio
// ---------------------------------------------------------------------------------------

/** Quanti giorni prima della scadenza un documento si dice "in scadenza". */
export const GIORNI_IN_SCADENZA = 30;

const ETICHETTE_STATO = {
  valido: "Valido",
  in_scadenza: "In scadenza",
  scaduto: "Scaduto",
  archiviato: "Archiviato",
};

export const etichettaStatoDocumento = (stato) => ETICHETTE_STATO[stato] ?? "";

/**
 * Lo stato di ogni documento di un socio: `valido`, `in_scadenza`, `scaduto`, `archiviato`.
 *
 * L'archivio non è una colonna nel database: è una conseguenza delle date, e si ricalcola a
 * ogni lettura. Salvarlo vorrebbe dire avere un campo che diventa falso da solo alla
 * mezzanotte di una scadenza, e qualcosa che lo aggiorni — un lavoro periodico che prima o
 * poi non gira, lasciando documenti nello stato sbagliato senza che nessuno se ne accorga.
 *
 * **Perché certificato medico e documento di identità non si archiviano da soli.** Sono i
 * due tipi che la scheda segnala quando mancano (`atteso`). Se un certificato scaduto
 * sparisse in archivio senza che ne sia arrivato uno nuovo, la sezione direbbe "Mancante" —
 * che è un'altra cosa, e più rassicurante del vero: "manca" si risolve chiedendolo al socio,
 * "scaduto" vuol dire che quella persona si sta allenando senza copertura. Finché non arriva
 * il sostituto, quello scaduto resta dov'è, con il suo bollino rosso. Gli "altri" documenti
 * non segnalano niente quando mancano, quindi appena scadono possono andare via.
 *
 * `giorniAllaScadenza(data)` torna i giorni interi che mancano (negativi se è passata) e
 * `null` se la data non c'è. La passa chi chiama: il browser ce l'ha in `core/domain/format`,
 * il server nelle sue funzioni di rotta, e sono calcoli sul calendario che non vale la pena
 * riscrivere qui una terza volta.
 */
/**
 * Quando un documento è stato caricato, come numero da confrontare.
 *
 * Si passa da `Date` e non dal confronto fra stringhe perché le due parti non ricevono la
 * stessa cosa: al browser `created_date` arriva come testo ISO dal JSON, al server come
 * oggetto `Date` letto da PostgreSQL. `String(new Date(...))` produce "Sat Jan 10 2019…",
 * che in ordine alfabetico mette agosto prima di gennaio — l'archivio avrebbe tenuto in
 * vista il documento sbagliato, e solo sul server.
 */
function quandoCaricato(doc) {
  const istante = new Date(doc?.created_date ?? 0).getTime();
  return Number.isNaN(istante) ? 0 : istante;
}

export function conStatoDocumenti(documenti, giorniAllaScadenza) {
  // L'ultimo caricato per ogni tipo: è quello che resta in vista, gli altri sono storia.
  const ultimoPerTipo = new Map();
  for (const doc of documenti) {
    const quando = quandoCaricato(doc);
    const attuale = ultimoPerTipo.get(doc.document_type);
    if (attuale === undefined || quando > attuale) ultimoPerTipo.set(doc.document_type, quando);
  }

  return documenti.map((doc) => {
    const giorni = giorniAllaScadenza(doc.expiry_date);
    // Senza data di scadenza non scade: è il caso degli "altri" documenti, che restano
    // validi finché qualcuno non li elimina a mano.
    const scaduto = giorni !== null && giorni < 0;
    const sostituito = quandoCaricato(doc) < (ultimoPerTipo.get(doc.document_type) ?? 0);
    const atteso = Boolean(PER_TIPO[doc.document_type]?.atteso);
    const archiviato = scaduto && (atteso ? sostituito : true);

    let stato = "valido";
    if (archiviato) stato = "archiviato";
    else if (scaduto) stato = "scaduto";
    else if (giorni !== null && giorni <= GIORNI_IN_SCADENZA) stato = "in_scadenza";

    return { ...doc, stato, giorni_alla_scadenza: giorni };
  });
}
