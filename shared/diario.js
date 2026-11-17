// Il diario di una persona, in parole, e gli elenchi chiusi che ci finiscono dentro.
//
// Prima questo file era shared/lead.js: i lead sono usciti dall'applicazione il 17/11/2026
// (archivio/lead). Restano qui le regole che usano soci e diario; le righe scritte quando
// c'erano i contatti (tentativo, risposta, chiusura…) restano nel diario e si descrivono ancora.

/** Variazione percentuale da `prima` a `ora`, null se prima era zero. */
export const variazione = (ora, prima) => (prima ? (ora - prima) / prima : null);

/** Con che mezzo lo si è cercato. */
export const CANALI_CONTATTO = [
  { valore: "telefono", etichetta: "Telefono" },
  { valore: "whatsapp", etichetta: "WhatsApp" },
  { valore: "email", etichetta: "Email" },
  { valore: "sms", etichetta: "SMS" },
  { valore: "di_persona", etichetta: "Di persona" },
];

/**
 * Com'è andato un contatto con un socio. Oggi da Da fare si segna solo "fatto", e il bancone
 * "salutato" o "proposto il rinnovo"; gli altri restano per le righe già scritte.
 */
export const ESITI_CONTATTO = [
  { valore: "fatto", etichetta: "fatto" },
  { valore: "risposto", etichetta: "ha risposto" },
  { valore: "nessuna_risposta", etichetta: "non ha risposto" },
  { valore: "proposto_rinnovo", etichetta: "proposto il rinnovo" },
  { valore: "salutato", etichetta: "salutato" },
];
export const esitoContattoValido = (v) => ESITI_CONTATTO.some((e) => e.valore === v);

// I motivi per cui un contatto non era interessato: servono solo alle righe già scritte.
const MOTIVI_CHIUSURA = [
  { valore: "prezzo", etichetta: "Prezzo" },
  { valore: "orari", etichetta: "Orari" },
  { valore: "distanza", etichetta: "Distanza" },
  { valore: "altra_struttura", etichetta: "Ha scelto un'altra struttura" },
  { valore: "altro", etichetta: "Altro" },
];

/**
 * Perché un socio se ne va: lo sceglie la reception archiviandolo, anche da uno "scaduto da
 * recuperare" che non torna. Un elenco chiuso, non una nota, così si contano (la dashboard).
 */
export const MOTIVI_ABBANDONO = [
  { valore: "prezzo", etichetta: "Prezzo" },
  { valore: "orari", etichetta: "Orari" },
  { valore: "tempo", etichetta: "Poco tempo, lavoro" },
  { valore: "trasferimento", etichetta: "Si è trasferito" },
  { valore: "salute", etichetta: "Salute o infortunio" },
  { valore: "motivazione", etichetta: "Ha perso la motivazione" },
  { valore: "servizio", etichetta: "Non soddisfatto" },
  { valore: "altra_struttura", etichetta: "Ha scelto un'altra struttura" },
  { valore: "non_risponde", etichetta: "Non risponde più" },
  { valore: "altro", etichetta: "Altro" },
];
export const motivoAbbandonoValido = (v) => MOTIVI_ABBANDONO.some((m) => m.valore === v);

const etichetta = (elenco, v) => elenco.find((x) => x.valore === v)?.etichetta ?? v ?? "";
export const etichettaCanaleContatto = (v) => etichetta(CANALI_CONTATTO, v);
export const etichettaMotivoAbbandono = (v) => etichetta(MOTIVI_ABBANDONO, v);

const dataBreve = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split("-"); return `${g}/${m}/${a}`; };

/** Il massimo di una nota scritta nel diario di una persona. */
export const NOTA_DIARIO_MASSIMO = 500;

/**
 * Una riga del diario di una persona, in parole: "Contattato via Telefono: non ha risposto".
 * La stessa frase nel diario della scheda e nel registro delle azioni.
 */
export function descriviAttivita(a) {
  switch (a.tipo) {
    // Righe di quando c'erano i lead (archivio/lead): restano nel diario.
    case "tentativo": return `Contattato via ${etichettaCanaleContatto(a.canale)}: non ha risposto`;
    case "risposta": return `Contattato via ${etichettaCanaleContatto(a.canale)}: ha risposto`;
    case "richiamo": return `Da richiamare il ${dataBreve(a.esito)}`;
    case "chiusura": return `Non interessato: ${etichetta(MOTIVI_CHIUSURA, a.esito)}`;
    case "riapertura": return "Riaperto";
    case "stato_automatico": return a.esito === "non_raggiungibile" ? "Passato a «Non raggiungibile»" : `Passato a «${a.esito}»`;
    case "iscrizione": return a.esito === "riattivato" ? "Tornato socio" : "Diventato socio";
    case "contatto":
      // Il "Fatto" di Da fare: il mezzo non conta; per che cosa lo dice la riga (il segnale sta nel riferimento).
      if (a.esito === "fatto") return "Fatto";
      return `${etichettaCanaleContatto(a.canale)}: ${etichetta(ESITI_CONTATTO, a.esito)}`;
    case "rimando": return `Rimandato al ${dataBreve(a.esito)}`;
    case "nota": return "Nota";
    case "nota_istruttore": return "Nota dell'istruttore";
    case "richiesta_rinnovo": return "Ha chiesto il rinnovo dal portale";
    case "sospensione": {
      const [dal, al] = String(a.esito ?? "").split("/");
      return al ? `Abbonamento sospeso dal ${dataBreve(dal)} al ${dataBreve(al)}` : "Abbonamento sospeso";
    }
    case "fine_sospensione": return `Sospensione finita: riprende il ${dataBreve(a.esito)}`;
    case "abbandono": return `Ha lasciato la palestra: ${etichettaMotivoAbbandono(a.esito)}`;
    case "riattivazione": return "Tornato socio";
    // Archiviato dal giro: senza abbonamento da troppo tempo (shared/soglie.js, archiviazioneGiorni).
    case "archiviazione_automatica": return "Archiviato automaticamente";
    // Le cose da fare, come le scrive il giro (giro.js): quando compaiono e quando non ci sono più.
    case "segnale_aperto": return "Da fare";
    case "segnale_chiuso": return "Non più da fare";
    // Righe di quando c'erano le comunicazioni automatiche (archivio/comunicazioni): restano nel diario.
    case "messaggio": return "Messaggio automatico";
    case "ingresso_dopo_contatto": {
      const n = Number(a.esito);
      return `Tornato in palestra ${n === 0 ? "il giorno stesso del contatto" : n === 1 ? "il giorno dopo il contatto" : `${n} giorni dopo il contatto`}`;
    }
    default: return a.tipo;
  }
}
