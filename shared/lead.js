// I conti sui contatti: quanti ne arrivano, quando, da dove, di chi.
//
// Stanno in `shared/` come le altre regole di dominio, e sono funzioni pure: la pagina
// "Andamento" scarica i lead e li conta qui, e i test le provano con `node --test`.
//
import { giorniFra } from "./giorni.js";

// Le date sono stringhe `AAAA-MM-GG`, come arrivano dall'API: anno e mese si leggono dal testo,
// senza passare per `Date` e per i fusi orari.

/** Quanto può essere lunga la nota di un contatto: due righe, non una scheda. */
export const NOTE_LEAD_MASSIMO = 140;

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

// ---------------------------------------------------------------------------------------
// Gli stati di un lead: il flusso di contatto, fino alla trasformazione in socio
// ---------------------------------------------------------------------------------------
//
// Pochi stati scritti, che dicono *a che punto* è il rapporto; il *da quanto* non si scrive,
// si calcola dalle date (`condizioniLead`). Un "contattato dieci giorni fa" salvato come stato
// sarebbe falso il giorno dopo; calcolato, è sempre vero. Sono queste condizioni — stato più
// tempo trascorso — che faranno partire messaggi e notifiche quando ci saranno, e che oggi
// fanno i filtri rapidi della pagina Contatti: la lista del lavoro del giorno.
//
// Lo stato non lo sceglie nessuno da un menu: lo cambiano le azioni (`applicaAzione`).
// *Iscritto* non è uno stato: trasformato in socio, il lead si cancella e la provenienza resta
// sul socio.

export const STATI_LEAD = [
  { valore: "nuovo", etichetta: "Nuovo", aperto: true, tono: "info" },
  { valore: "in_attesa", etichetta: "In attesa di risposta", aperto: true, tono: "attesa" },
  { valore: "in_conversazione", etichetta: "In conversazione", aperto: true, tono: "positivo" },
  { valore: "da_richiamare", etichetta: "Da richiamare", aperto: true, tono: "attesa" },
  { valore: "non_raggiungibile", etichetta: "Non raggiungibile", aperto: false, tono: "neutro" },
  { valore: "non_interessato", etichetta: "Non interessato", aperto: false, tono: "negativo" },
];
const PER_STATO = Object.fromEntries(STATI_LEAD.map((s) => [s.valore, s]));
export const statoLead = (v) => PER_STATO[v] ?? PER_STATO.nuovo;
export const statoAperto = (v) => Boolean(PER_STATO[v]?.aperto);

/** Con che mezzo lo si è cercato: non è il canale da cui è arrivato. */
export const CANALI_CONTATTO = [
  { valore: "telefono", etichetta: "Telefono" },
  { valore: "whatsapp", etichetta: "WhatsApp" },
  { valore: "email", etichetta: "Email" },
  { valore: "sms", etichetta: "SMS" },
  { valore: "di_persona", etichetta: "Di persona" },
];

export const MOTIVI_CHIUSURA = [
  { valore: "prezzo", etichetta: "Prezzo" },
  { valore: "orari", etichetta: "Orari" },
  { valore: "distanza", etichetta: "Distanza" },
  { valore: "altra_struttura", etichetta: "Ha scelto un'altra struttura" },
  { valore: "altro", etichetta: "Altro" },
];

const etichetta = (elenco, v) => elenco.find((x) => x.valore === v)?.etichetta ?? v ?? "";
export const etichettaCanaleContatto = (v) => etichetta(CANALI_CONTATTO, v);
export const etichettaMotivoChiusura = (v) => etichetta(MOTIVI_CHIUSURA, v);

/**
 * Le soglie, in giorni. Oggi sono le stesse per tutti; quando l'ente vorrà deciderle, si
 * leggeranno dalla sua configurazione invece che da qui.
 */
export const SOGLIE_LEAD = {
  sollecitoGiorni: 3, // in attesa da tanto: "Da ricontattare"
  ultimoTentativoGiorni: 10, // in attesa da tanto: "Ultimo tentativo"
  tentativiMassimi: 3, // tentativi di fila senza risposta prima di arrendersi
  nonRaggiungibileGiorni: 14, // …e da quanto dev'essere l'ultimo, per chiuderlo da solo
  fermaGiorni: 7, // una conversazione senza novità da tanto: "Conversazioni ferme"
  recuperoGiorni: 90, // un "non interessato" da tanto: si può riprovare
};

const giorniDa = (data, oggi) => (data ? giorniFra(String(data).slice(0, 10), oggi) : null);

/**
 * Cosa scrivere sul lead per un'azione, o il motivo per cui non si può.
 *
 * I tentativi contati sono quelli **di fila senza risposta**: una risposta li azzera.
 *
 * @param lead   { stato, tentativi_senza_risposta, ultimo_contatto_il }
 * @param azione { tipo: 'contatto', canale, esito: 'risposto'|'nessuna_risposta' }
 *             | { tipo: 'richiamo', data } | { tipo: 'chiudi', motivo, nota } | { tipo: 'riapri' }
 * @returns {{ errore: string } | { campi: object, attivita: object }}
 *   `campi`: le colonne del lead in snake_case; `attivita`: la riga del diario.
 */
export function applicaAzione(lead, azione, oggi) {
  const aperto = statoAperto(lead.stato);
  const nuovoStato = (stato) => (stato === lead.stato ? {} : { stato, stato_dal: oggi });

  if (azione.tipo === "contatto") {
    if (!aperto) return { errore: "Il contatto è chiuso: riaprilo prima." };
    if (!CANALI_CONTATTO.some((c) => c.valore === azione.canale)) return { errore: "Indica come l'hai contattato." };
    if (azione.esito === "risposto") {
      return {
        campi: {
          ...nuovoStato("in_conversazione"), tentativi_senza_risposta: 0,
          ultimo_contatto_il: oggi, ultima_risposta_il: oggi, richiamare_il: null,
        },
        attivita: { tipo: "risposta", canale: azione.canale, esito: "risposto" },
      };
    }
    if (azione.esito === "nessuna_risposta") {
      return {
        campi: {
          ...nuovoStato("in_attesa"), tentativi_senza_risposta: (Number(lead.tentativi_senza_risposta) || 0) + 1,
          ultimo_contatto_il: oggi, richiamare_il: null,
        },
        attivita: { tipo: "tentativo", canale: azione.canale, esito: "nessuna_risposta" },
      };
    }
    return { errore: "Indica se ha risposto." };
  }

  if (azione.tipo === "richiamo") {
    if (!aperto) return { errore: "Il contatto è chiuso: riaprilo prima." };
    const data = String(azione.data ?? "").slice(0, 10);
    if (giorniFra(oggi, data) === null) return { errore: "Indica quando richiamarlo." };
    if (data < oggi) return { errore: "La data del richiamo non può essere nel passato." };
    return { campi: { ...nuovoStato("da_richiamare"), richiamare_il: data }, attivita: { tipo: "richiamo", esito: data } };
  }

  if (azione.tipo === "chiudi") {
    if (!aperto) return { errore: "Il contatto è già chiuso." };
    if (!MOTIVI_CHIUSURA.some((m) => m.valore === azione.motivo)) return { errore: "Scegli il motivo." };
    if (azione.motivo === "altro" && !String(azione.nota ?? "").trim()) return { errore: "Con «Altro» scrivi il motivo nella nota." };
    return {
      campi: { ...nuovoStato("non_interessato"), motivo_chiusura: azione.motivo, richiamare_il: null },
      attivita: { tipo: "chiusura", esito: azione.motivo },
    };
  }

  if (azione.tipo === "riapri") {
    if (aperto) return { errore: "Il contatto è già aperto." };
    // Si riparte da capo coi tentativi: altrimenti un "non raggiungibile" riaperto si
    // richiuderebbe da solo alla prima lettura.
    return {
      campi: {
        ...nuovoStato(lead.ultimo_contatto_il ? "in_attesa" : "nuovo"),
        tentativi_senza_risposta: 0, motivo_chiusura: null,
      },
      attivita: { tipo: "riapertura" },
    };
  }

  return { errore: "Azione sconosciuta." };
}

/** Se un lead è da chiudere da solo come non raggiungibile: troppi tentativi, e l'ultimo da tanto. */
export function daChiudereComeNonRaggiungibile(lead, oggi, soglie = SOGLIE_LEAD) {
  return lead.stato === "in_attesa"
    && (Number(lead.tentativi_senza_risposta) || 0) >= soglie.tentativiMassimi
    && (giorniDa(lead.ultimo_contatto_il, oggi) ?? 0) >= soglie.nonRaggiungibileGiorni;
}

/** I filtri rapidi della pagina Contatti, nell'ordine in cui compaiono. */
export const FILTRI_LEAD = [
  { valore: "aperti", etichetta: "Aperti" },
  { valore: "da_contattare", etichetta: "Da contattare" },
  { valore: "da_ricontattare", etichetta: "Da ricontattare" },
  { valore: "ultimo_tentativo", etichetta: "Ultimo tentativo" },
  { valore: "richiami_oggi", etichetta: "Richiami di oggi" },
  { valore: "conversazioni_ferme", etichetta: "Conversazioni ferme" },
  { valore: "da_recuperare", etichetta: "Da recuperare" },
  { valore: "chiusi", etichetta: "Chiusi" },
];

/**
 * In quali filtri rapidi cade un lead oggi. Sono anche i futuri trigger delle automazioni.
 *
 * - da_contattare: nuovo, mai cercato.
 * - da_ricontattare: in attesa di risposta da `sollecitoGiorni` a `ultimoTentativoGiorni`.
 * - ultimo_tentativo: in attesa da `ultimoTentativoGiorni` o più.
 * - richiami_oggi: da richiamare, con la data oggi o già passata.
 * - conversazioni_ferme: ha risposto, ma da `fermaGiorni` non succede niente.
 * - da_recuperare: non interessato da `recuperoGiorni` o più.
 */
export function condizioniLead(lead, oggi, soglie = SOGLIE_LEAD) {
  const c = new Set([statoAperto(lead.stato) ? "aperti" : "chiusi"]);
  const attesa = giorniDa(lead.ultimo_contatto_il, oggi) ?? 0;
  if (lead.stato === "nuovo") c.add("da_contattare");
  if (lead.stato === "in_attesa") {
    if (attesa >= soglie.ultimoTentativoGiorni) c.add("ultimo_tentativo");
    else if (attesa >= soglie.sollecitoGiorni) c.add("da_ricontattare");
  }
  if (lead.stato === "da_richiamare" && lead.richiamare_il && String(lead.richiamare_il).slice(0, 10) <= oggi) c.add("richiami_oggi");
  if (lead.stato === "in_conversazione") {
    const ultimaNovita = [lead.ultimo_contatto_il, lead.ultima_risposta_il, lead.stato_dal]
      .filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop();
    if ((giorniDa(ultimaNovita, oggi) ?? 0) >= soglie.fermaGiorni) c.add("conversazioni_ferme");
  }
  if (lead.stato === "non_interessato" && (giorniDa(lead.stato_dal, oggi) ?? 0) >= soglie.recuperoGiorni) c.add("da_recuperare");
  return c;
}

/** Quanti lead per ogni filtro rapido. */
export function contaFiltriLead(leads = [], oggi, soglie = SOGLIE_LEAD) {
  const conti = Object.fromEntries(FILTRI_LEAD.map((f) => [f.valore, 0]));
  for (const l of leads) for (const c of condizioniLead(l, oggi, soglie)) conti[c] += 1;
  return conti;
}

const quanto = (giorni) => (giorni <= 0 ? "oggi" : giorni === 1 ? "ieri" : `${giorni} giorni fa`);
const dataBreve = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split("-"); return `${g}/${m}/${a}`; };

/** Il tempo dello stato, in una riga: "contattato 10 giorni fa · 2 tentativi senza risposta", "richiamare il 12/10/2026". */
export function descriviTempoLead(lead, oggi) {
  switch (lead.stato) {
    case "nuovo": {
      const g = giorniDa(lead.data_contatto, oggi);
      return g === null ? "" : `arrivato ${quanto(g)}`;
    }
    case "in_attesa": {
      const n = Number(lead.tentativi_senza_risposta) || 0;
      return `contattato ${quanto(giorniDa(lead.ultimo_contatto_il, oggi) ?? 0)} · ${n} ${n === 1 ? "tentativo" : "tentativi"} senza risposta`;
    }
    case "in_conversazione":
      return `ha risposto ${quanto(giorniDa(lead.ultima_risposta_il ?? lead.stato_dal, oggi) ?? 0)}`;
    case "da_richiamare": {
      if (!lead.richiamare_il) return "";
      const ritardo = giorniDa(lead.richiamare_il, oggi);
      if (ritardo === 0) return "richiamare oggi";
      if (ritardo > 0) return `richiamo in ritardo di ${ritardo} ${ritardo === 1 ? "giorno" : "giorni"}`;
      return `richiamare il ${dataBreve(lead.richiamare_il)}`;
    }
    case "non_interessato":
      return [etichettaMotivoChiusura(lead.motivo_chiusura), lead.stato_dal && `dal ${dataBreve(lead.stato_dal)}`].filter(Boolean).join(" · ");
    case "non_raggiungibile":
      return lead.stato_dal ? `dal ${dataBreve(lead.stato_dal)}` : "";
    default:
      return "";
  }
}
