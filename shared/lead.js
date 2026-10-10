// I conti sui contatti: quanti ne arrivano, quando, da dove, di chi.
//
// Stanno in `shared/` come le altre regole di dominio, e sono funzioni pure: la pagina
// "Andamento" riceve dal server righe anonime e le conta qui, la pagina Contatti ci legge gli
// stati, e i test le provano con `node --test`.
//
import { giorniFra } from "./giorni.js";
import { SOGLIE } from "./soglie.js";
import { normalizzaTelefono } from "./anagrafica.js";

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

// ---------------------------------------------------------------------------------------
// Andamento: i conti della pagina, su righe anonime
// ---------------------------------------------------------------------------------------
//
// Una riga è una persona che ci ha contattato, e dove è finita: ancora un lead aperto, un lead
// chiuso (perso), oppure un socio — il lead si cancella alla trasformazione, ma il socio ricorda
// canale e giorno del primo contatto. Le righe le prepara il server (GET /api/lead/andamento):
//   { data_contatto, canale_id, sesso, anno_nascita, esito: 'socio'|'aperto'|'perso',
//     socio_dal, motivo }
//
// Il tasso di conversione è **per coorte**: dei contatti arrivati nel periodo, quanti sono
// diventati soci (anche dopo). È l'unico che non mescola persone diverse al numeratore e al
// denominatore. Gli ultimi arrivati abbassano il tasso finché sono aperti: lo si dice accanto.

/** Le fasce d'età, calcolate all'anno del contatto. */
export const FASCE_ETA = [
  { valore: "u18", etichetta: "Under 18", da: 0, a: 17 },
  { valore: "18-24", etichetta: "18–24", da: 18, a: 24 },
  { valore: "25-34", etichetta: "25–34", da: 25, a: 34 },
  { valore: "35-44", etichetta: "35–44", da: 35, a: 44 },
  { valore: "45-54", etichetta: "45–54", da: 45, a: 54 },
  { valore: "55+", etichetta: "55 e oltre", da: 55, a: 200 },
  { valore: "nd", etichetta: "Non indicata", da: null, a: null },
];

/** La fascia d'età di una riga, "nd" se l'anno di nascita non c'è. */
export function fasciaEta(riga) {
  const nascita = Number(riga?.anno_nascita);
  const anno = annoDi(riga?.data_contatto);
  if (!nascita || !anno) return "nd";
  const eta = anno - nascita;
  return FASCE_ETA.find((f) => f.da !== null && eta >= f.da && eta <= f.a)?.valore ?? "nd";
}

export const ESITI = [
  { valore: "socio", etichetta: "Diventati soci" },
  { valore: "aperto", etichetta: "In corso" },
  { valore: "perso", etichetta: "Persi" },
];

const iso = (a, m, g) => `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
const fineMese = (a, m) => iso(a, m, new Date(Date.UTC(a, m, 0)).getUTCDate());

/** "2026-10" e i mesi da `dal` ad `al`, compresi. */
function mesiFra(dal, al) {
  const mesi = [];
  let [a, m] = [Number(dal.slice(0, 4)), Number(dal.slice(5, 7))];
  const fine = al.slice(0, 7);
  while (`${a}-${String(m).padStart(2, "0")}` <= fine) {
    mesi.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return mesi;
}

/**
 * Il periodo scelto, in date: "ultimi_12" (i dodici mesi interi fino a questo), "anno" (da
 * gennaio a oggi) oppure un anno, "2025". `precedente` è lo stesso periodo un anno prima: il
 * confronto con l'anno scorso toglie la stagionalità, che per una palestra è tutto.
 */
export function intervalloPeriodo(periodo, oggi) {
  const anno = Number(oggi.slice(0, 4));
  const mese = Number(oggi.slice(5, 7));
  let dal; let al;
  if (periodo === "anno") { dal = iso(anno, 1, 1); al = oggi; }
  else if (/^\d{4}$/.test(String(periodo))) { dal = iso(Number(periodo), 1, 1); al = iso(Number(periodo), 12, 31); }
  else {
    const inizio = mese === 12 ? [anno, 1] : [anno - 1, mese + 1];
    dal = iso(inizio[0], inizio[1], 1);
    al = fineMese(anno, mese);
  }
  const indietro = (d) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, "-02-28");
  return { dal, al, mesi: mesiFra(dal, al), precedente: { dal: indietro(dal), al: indietro(al) } };
}

/**
 * Le righe che rispettano i filtri. Un filtro assente non filtra.
 * @param filtri { dal, al, canaleId, sesso, fascia, mese: "AAAA-MM" }
 */
export function filtraAndamento(righe = [], { dal, al, canaleId, sesso, fascia, mese } = {}) {
  return righe.filter((r) => {
    const d = String(r.data_contatto ?? "").slice(0, 10);
    return (!dal || d >= dal) && (!al || d <= al)
      && (!mese || d.slice(0, 7) === mese)
      && (!canaleId || r.canale_id === canaleId)
      && (!sesso || (r.sesso ?? "nd") === sesso)
      && (!fascia || fasciaEta(r) === fascia);
  });
}

const giorniTra = (da, a) => Math.round((Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(da).slice(0, 10)}T00:00:00Z`)) / 86400000);

/** I numeri in testa alla pagina. `tasso` è fra 0 e 1, null senza contatti. */
export function riepilogoAndamento(righe = []) {
  const soci = righe.filter((r) => r.esito === "socio");
  const giorni = soci.filter((r) => r.socio_dal).map((r) => Math.max(0, giorniTra(r.data_contatto, r.socio_dal)));
  return {
    contatti: righe.length,
    soci: soci.length,
    aperti: righe.filter((r) => r.esito === "aperto").length,
    persi: righe.filter((r) => r.esito === "perso").length,
    tasso: righe.length ? soci.length / righe.length : null,
    giorniMedi: giorni.length ? Math.round(giorni.reduce((s, g) => s + g, 0) / giorni.length) : null,
  };
}

/** Variazione percentuale da `prima` a `ora`, null se prima era zero. */
export const variazione = (ora, prima) => (prima ? (ora - prima) / prima : null);

/**
 * Mese per mese: i contatti, quanti di loro sono diventati soci, e i contatti dello stesso mese
 * dell'anno prima. Ogni mese c'è, anche a zero: un mese vuoto è un dato.
 */
export function serieMensile(righe = [], mesi = [], righeAnnoPrima = []) {
  const conta = (elenco, chiave) => {
    const m = new Map();
    for (const r of elenco) {
      const k = String(r.data_contatto).slice(0, 7);
      if (!chiave || chiave(r)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const contatti = conta(righe);
  const soci = conta(righe, (r) => r.esito === "socio");
  const prima = conta(righeAnnoPrima);
  return mesi.map((mese) => {
    const [a, m] = mese.split("-");
    return {
      mese,
      etichetta: MESI[Number(m) - 1].slice(0, 3),
      etichettaLunga: `${MESI[Number(m) - 1]} ${a}`,
      contatti: contatti.get(mese) ?? 0,
      soci: soci.get(mese) ?? 0,
      annoPrima: prima.get(`${Number(a) - 1}-${m}`) ?? 0,
    };
  });
}

/** Per canale: contatti, e come sono finiti. Dal canale che ne porta di più. */
export function esitiPerCanale(righe = [], canali = []) {
  const per = new Map();
  for (const r of righe) {
    if (!per.has(r.canale_id)) per.set(r.canale_id, { canale_id: r.canale_id, contatti: 0, socio: 0, aperto: 0, perso: 0 });
    const v = per.get(r.canale_id);
    v.contatti += 1;
    v[r.esito] = (v[r.esito] ?? 0) + 1;
  }
  const nome = new Map(canali.map((c) => [c.id, c.nome]));
  return [...per.values()]
    .map((v) => ({ ...v, nome: nome.get(v.canale_id) ?? "Canale eliminato", tasso: v.contatti ? v.socio / v.contatti : null }))
    .sort((a, b) => b.contatti - a.contatti || a.nome.localeCompare(b.nome, "it"));
}

/** Stagionalità: per canale, i contatti in ciascun mese dell'anno (gennaio…dicembre), sommando gli anni. */
export function matriceStagionalita(righe = [], canali = []) {
  const ordine = esitiPerCanale(righe, canali);
  const righeMatrice = ordine.map((c) => ({ canale_id: c.canale_id, nome: c.nome, mesi: Array(12).fill(0) }));
  const indice = new Map(righeMatrice.map((r, i) => [r.canale_id, i]));
  for (const r of righe) {
    const m = meseDi(r.data_contatto);
    if (m) righeMatrice[indice.get(r.canale_id)].mesi[m - 1] += 1;
  }
  const massimo = Math.max(0, ...righeMatrice.flatMap((r) => r.mesi));
  return { righe: righeMatrice, massimo };
}

/** Perché si perdono: i motivi dei lead chiusi, "non raggiungibile" compreso. */
export function motiviPerdita(righe = []) {
  const conti = new Map();
  for (const r of righe) if (r.esito === "perso") conti.set(r.motivo ?? "altro", (conti.get(r.motivo ?? "altro") ?? 0) + 1);
  return [...conti.entries()].map(([motivo, totale]) => ({ motivo, totale })).sort((a, b) => b.totale - a.totale);
}

/** Quanti per un campo calcolato, in un ordine dato (fasce, sessi): anche gli zeri. */
export function contaInOrdine(righe = [], chiave, valori) {
  const conti = new Map(valori.map((v) => [v, 0]));
  for (const r of righe) {
    const k = chiave(r);
    if (conti.has(k)) conti.set(k, conti.get(k) + 1);
  }
  return valori.map((valore) => ({ valore, totale: conti.get(valore) }));
}

/** Gli anni in cui ci sono contatti, dal più recente: le voci del periodo oltre a quelle fisse. */
export function anniDisponibili(righe = []) {
  return [...new Set(righe.map((r) => annoDi(r.data_contatto)).filter(Boolean))].sort((a, b) => b - a);
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
//
// Un lead è una *trattativa* di una persona: la persona resta (con il suo diario) e può averne
// più d'una nel tempo — chi ha lasciato la palestra e ci richiama ne apre una nuova. *Iscritto*
// chiude la trattativa vinta: la persona è diventata socia, o è tornata a esserlo.

export const STATI_LEAD = [
  { valore: "nuovo", etichetta: "Nuovo", aperto: true, tono: "info" },
  { valore: "in_attesa", etichetta: "In attesa di risposta", aperto: true, tono: "attesa" },
  { valore: "in_conversazione", etichetta: "In conversazione", aperto: true, tono: "positivo" },
  { valore: "da_richiamare", etichetta: "Da richiamare", aperto: true, tono: "attesa" },
  { valore: "non_raggiungibile", etichetta: "Non raggiungibile", aperto: false, tono: "neutro" },
  { valore: "non_interessato", etichetta: "Non interessato", aperto: false, tono: "negativo" },
  { valore: "iscritto", etichetta: "Iscritto", aperto: false, tono: "positivo" },
];
const PER_STATO = Object.fromEntries(STATI_LEAD.map((s) => [s.valore, s]));
export const statoLead = (v) => PER_STATO[v] ?? PER_STATO.nuovo;
export const statoAperto = (v) => Boolean(PER_STATO[v]?.aperto);
/** Gli stati di una trattativa ancora in corso: una persona ne ha al massimo una. */
export const STATI_APERTI = STATI_LEAD.filter((s) => s.aperto).map((s) => s.valore);

/**
 * Perché un contatto non si può registrare, o null.
 *
 * Il minimo per poterlo richiamare e contare: un nome, un recapito, da dove è arrivato e quando.
 * Cognome, sesso e anno di nascita aiutano, ma al telefono o su Instagram spesso non ci sono:
 * chiederli obbligatori voleva dire contatti non registrati, e un contatto non registrato non
 * si richiama e non si conta.
 */
export function motivoLeadIncompleto(c = {}) {
  if (!String(c.nome ?? "").trim()) return "Il nome è obbligatorio.";
  const telefono = String(c.telefono ?? "").trim();
  if (!telefono && !String(c.email ?? "").trim()) return "Serve un recapito: telefono o email.";
  if (telefono && !normalizzaTelefono(telefono)) return "Il telefono non è valido.";
  if (!c.canale_id) return "Indica il canale da cui è arrivato.";
  if (!c.data_contatto) return "Indica il giorno del contatto.";
  if (String(c.note ?? "").trim().length > NOTE_LEAD_MASSIMO) return `Le note stanno in ${NOTE_LEAD_MASSIMO} caratteri.`;
  return null;
}

/** Con che mezzo lo si è cercato: non è il canale da cui è arrivato. */
export const CANALI_CONTATTO = [
  { valore: "telefono", etichetta: "Telefono" },
  { valore: "whatsapp", etichetta: "WhatsApp" },
  { valore: "email", etichetta: "Email" },
  { valore: "sms", etichetta: "SMS" },
  { valore: "di_persona", etichetta: "Di persona" },
];

/**
 * Com'è andato un contatto con una persona — un socio da Oggi, dalla scheda o dal bancone. Il
 * contatto con un lead passa invece dalle sue azioni (`applicaAzione`), che ne cambiano lo stato.
 */
export const ESITI_CONTATTO = [
  { valore: "risposto", etichetta: "ha risposto" },
  { valore: "nessuna_risposta", etichetta: "non ha risposto" },
  { valore: "proposto_rinnovo", etichetta: "proposto il rinnovo" },
  { valore: "salutato", etichetta: "salutato" },
];
export const esitoContattoValido = (v) => ESITI_CONTATTO.some((e) => e.valore === v);

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

/** Le soglie predefinite, in giorni (shared/soglie.js); quelle della palestra le dà `soglieDi`. */
export const SOGLIE_LEAD = SOGLIE.lead;

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
  // Una trattativa vinta è storia: chi è già socio e richiama apre una trattativa nuova.
  if (lead.stato === "iscritto") return { errore: "Questo contatto è diventato socio: non si lavora più da qui." };
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

/** Il massimo di una nota scritta nel diario di una persona. */
export const NOTA_DIARIO_MASSIMO = 500;

/**
 * Una riga del diario di una persona, in parole: "Contattato via Telefono: non ha risposto".
 * La stessa frase nel diario della scheda e nel registro delle azioni.
 */
export function descriviAttivita(a) {
  switch (a.tipo) {
    case "tentativo": return `Contattato via ${etichettaCanaleContatto(a.canale)}: non ha risposto`;
    case "risposta": return `Contattato via ${etichettaCanaleContatto(a.canale)}: ha risposto`;
    case "richiamo": return `Da richiamare il ${dataBreve(a.esito)}`;
    case "chiusura": return `Non interessato: ${etichettaMotivoChiusura(a.esito)}`;
    case "riapertura": return "Riaperto";
    case "stato_automatico": return `Passato a «${statoLead(a.esito).etichetta}»`;
    case "iscrizione": return a.esito === "riattivato" ? "Tornato socio" : "Diventato socio";
    case "contatto": return `${etichettaCanaleContatto(a.canale)}: ${etichetta(ESITI_CONTATTO, a.esito)}`;
    case "rimando": return `Rimandato al ${dataBreve(a.esito)}`;
    case "nota": return "Nota";
    default: return a.tipo;
  }
}

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
