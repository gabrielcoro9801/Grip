// Le regole dell'anagrafica, uguali per soci e lead, per il server e per le schermate.
//
// Il codice fiscale sta qui e non in un modulo: la segreteria lo scrive a mano, e un
// carattere sbagliato non si nota finché non serve — al tesseramento, su una ricevuta. Il
// controllo va fatto mentre lo si digita (schermate) e di nuovo quando arriva (server): con
// due copie della regola, prima o poi una delle due accetterebbe un codice che l'altra rifiuta.
import { oggiIso, eUnGiorno } from "./giorni.js";
import { SOGLIE } from "./soglie.js";

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
 * dei genitori e chi firma per lui. Per i lead no: lì basta l'anno, e nemmeno quello è richiesto.
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

// ---------------------------------------------------------------------------------------
// Documenti del socio
// ---------------------------------------------------------------------------------------

/**
 * I tipi di documento.
 *
 * `atteso` dice che la scheda del socio segnala quando manca: il certificato medico serve per
 * allenarsi, il documento di identità per il tesseramento, il consenso dei genitori — solo per
 * i minorenni (`"minorenni"`) — perché un minore si iscrive con la firma di chi ne è
 * responsabile. Gli altri si caricano se servono.
 * `scadenza` dice se la data di scadenza è obbligatoria: certificato e documento di identità
 * scadono entrambi, e senza la data la scheda non sa dire quando il socio va richiamato. Il
 * consenso non scade: vale finché il socio è minorenne, e poi resta nello storico.
 */
export const TIPI_DOCUMENTO = [
  { valore: "certificato_medico", etichetta: "Certificato medico", atteso: true, scadenza: true },
  { valore: "documento_identita", etichetta: "Documento di identità", atteso: true, scadenza: true },
  { valore: "consenso_genitori", etichetta: "Consenso dei genitori", atteso: "minorenni", scadenza: false },
  { valore: "altro", etichetta: "Altri documenti", atteso: false, scadenza: false },
];

const PER_TIPO = Object.fromEntries(TIPI_DOCUMENTO.map((t) => [t.valore, t]));

export const tipoDocumentoValido = (v) => v in PER_TIPO;
export const infoTipoDocumento = (v) => PER_TIPO[v] ?? null;

/**
 * Se per questo socio un tipo di documento va segnalato quando manca.
 * @param tipo  una voce di TIPI_DOCUMENTO, o il suo valore
 * @param socio { date_of_birth }
 */
export function tipoAtteso(tipo, socio, oggi = oggiIso()) {
  const voce = typeof tipo === "string" ? PER_TIPO[tipo] : tipo;
  if (voce?.atteso === "minorenni") return eMinorenne(socio?.date_of_birth, oggi);
  return Boolean(voce?.atteso);
}

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
export const GIORNI_IN_SCADENZA = SOGLIE.documentoInScadenzaGiorni;

const ETICHETTE_STATO = {
  valido: "Valido",
  in_scadenza: "In scadenza",
  scaduto: "Scaduto",
  archiviato: "Archiviato",
};

export const etichettaStatoDocumento = (stato) => ETICHETTE_STATO[stato] ?? "";

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

/**
 * Lo stato di ogni documento di un socio: `valido`, `in_scadenza`, `scaduto`, `archiviato`.
 *
 * L'archivio non è una colonna nel database: è una conseguenza delle date, e si ricalcola a
 * ogni lettura. Salvarlo vorrebbe dire avere un campo che diventa falso da solo alla
 * mezzanotte di una scadenza, e qualcosa che lo aggiorni — un lavoro periodico che prima o
 * poi non gira, lasciando documenti nello stato sbagliato senza che nessuno se ne accorga.
 *
 * **Perché certificato medico e documento di identità non si archiviano da soli.** Sono i
 * due tipi che la scheda segnala quando mancano (`atteso`), e la sezione non deve mai
 * restare vuota mentre un documento esiste: direbbe "Mancante", che è un'altra cosa e più
 * rassicurante del vero — "manca" si risolve chiedendolo al socio, "scaduto" vuol dire che
 * quella persona si sta allenando senza copertura. Per questi due tipi, quindi, uno scaduto
 * va in archivio **solo quando c'è qualcos'altro che lo rimpiazza**, e cioè:
 *
 *   - esiste un documento dello stesso tipo ancora buono, caricato prima o dopo non importa.
 *     Capita di registrare la copia di un certificato vecchio dopo aver già inserito quello
 *     nuovo: è storia che nasce archiviata, e non deve tornare a occupare la sezione;
 *   - oppure, se sono scaduti tutti, quello caricato per ultimo resta in vista e gli altri
 *     vanno via: è l'unico che dica ancora qualcosa di utile.
 *
 * Gli "altri" documenti non segnalano niente quando mancano, quindi appena scadono possono
 * andare in archivio senza tante condizioni.
 *
 * `giorniAllaScadenza(data)` torna i giorni interi che mancano (negativi se è passata) e
 * `null` se la data non c'è. La passa chi chiama: il browser ce l'ha in `core/domain/format`,
 * il server nelle sue funzioni di rotta, e sono calcoli sul calendario che non vale la pena
 * riscrivere qui una terza volta.
 */
export function conStatoDocumenti(documenti, giorniAllaScadenza) {
  // Se un documento sia scaduto si decide una volta sola: serve sia per il suo stato, sia
  // per sapere se i suoi fratelli dello stesso tipo hanno qualcosa di meglio da mostrare.
  const valutati = documenti.map((doc) => {
    const giorni = giorniAllaScadenza(doc.expiry_date);
    // Senza data di scadenza non scade: è il caso degli "altri" documenti, che restano
    // validi finché qualcuno non li elimina a mano.
    return { doc, giorni, scaduto: giorni !== null && giorni < 0 };
  });

  // Per ogni tipo: quando è stato caricato il più recente, e se ne esiste uno ancora buono.
  const ultimoPerTipo = new Map();
  const tipiConDocumentoBuono = new Set();
  for (const { doc, scaduto } of valutati) {
    const quando = quandoCaricato(doc);
    const attuale = ultimoPerTipo.get(doc.document_type);
    if (attuale === undefined || quando > attuale) ultimoPerTipo.set(doc.document_type, quando);
    if (!scaduto) tipiConDocumentoBuono.add(doc.document_type);
  }

  return valutati.map(({ doc, giorni, scaduto }) => {
    const rimpiazzato =
      tipiConDocumentoBuono.has(doc.document_type) ||
      quandoCaricato(doc) < (ultimoPerTipo.get(doc.document_type) ?? 0);
    const atteso = Boolean(PER_TIPO[doc.document_type]?.atteso);
    const archiviato = scaduto && (atteso ? rimpiazzato : true);

    let stato = "valido";
    if (archiviato) stato = "archiviato";
    else if (scaduto) stato = "scaduto";
    else if (giorni !== null && giorni <= GIORNI_IN_SCADENZA) stato = "in_scadenza";

    return { ...doc, stato, giorni_alla_scadenza: giorni };
  });
}
