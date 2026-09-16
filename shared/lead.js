// La strada di un lead: da chi è passato a chiedere a socio, o a contatto perso.
//
// Vive in `shared/` perché le stesse regole servono a due lati. Il server decide se un
// passaggio di stato è lecito; le schermate decidono quali pulsanti mostrare e come contare
// le prove della settimana. Con due copie, un giorno la reception vedrebbe un pulsante che
// il server rifiuta — o, peggio, la Dashboard e l'elenco conterebbero in modo diverso le
// stesse prove.
//
// Le date sono stringhe `AAAA-MM-GG`, come arrivano dall'API: confrontarle come testo è
// corretto e non costringe a passare per i fusi orari.

export const STATI_LEAD = [
  { valore: "nuovo", etichetta: "Nuovo" },
  { valore: "contattato", etichetta: "Contattato" },
  { valore: "prova_prenotata", etichetta: "Prova prenotata" },
  { valore: "prova_svolta", etichetta: "Prova svolta" },
  { valore: "proposta", etichetta: "Proposta fatta" },
  { valore: "iscritto", etichetta: "Iscritto" },
  { valore: "perso", etichetta: "Perso" },
];

export const FONTI_LEAD = [
  { valore: "passaggio", etichetta: "Passato in sede" },
  { valore: "telefono", etichetta: "Telefono" },
  { valore: "instagram", etichetta: "Instagram" },
  { valore: "facebook", etichetta: "Facebook" },
  { valore: "sito", etichetta: "Sito web" },
  { valore: "passaparola", etichetta: "Passaparola" },
  { valore: "altro", etichetta: "Altro" },
];

// Il motivo per cui un contatto si perde è il dato che fra sei mesi dirà se il problema
// sono i prezzi o gli orari: per questo è una lista chiusa e non un campo libero, che
// nessuno riuscirebbe poi a contare.
export const MOTIVI_PERDITA = [
  { valore: "prezzo", etichetta: "Prezzo" },
  { valore: "orari", etichetta: "Orari" },
  { valore: "distanza", etichetta: "Distanza" },
  { valore: "altra_palestra", etichetta: "Scelta un'altra palestra" },
  { valore: "non_interessato", etichetta: "Non più interessato" },
  { valore: "irraggiungibile", etichetta: "Non risponde più" },
  { valore: "altro", etichetta: "Altro" },
];

export const TIPI_ATTIVITA = [
  { valore: "nota", etichetta: "Nota" },
  { valore: "chiamata", etichetta: "Chiamata" },
  { valore: "incontro", etichetta: "Incontro" },
  { valore: "cambio_stato", etichetta: "Cambio di stato" },
  { valore: "prova", etichetta: "Prova" },
];

/** Tipi che si registrano a mano: gli altri li scrive l'applicazione mentre succedono. */
export const TIPI_ATTIVITA_MANUALI = ["nota", "chiamata", "incontro"];

const etichette = (lista) => Object.fromEntries(lista.map((v) => [v.valore, v.etichetta]));
const ETICHETTE_STATO = etichette(STATI_LEAD);
const ETICHETTE_FONTE = etichette(FONTI_LEAD);
const ETICHETTE_MOTIVO = etichette(MOTIVI_PERDITA);
const ETICHETTE_ATTIVITA = etichette(TIPI_ATTIVITA);

export const etichettaStato = (v) => ETICHETTE_STATO[v] ?? v ?? "";
export const etichettaFonte = (v) => ETICHETTE_FONTE[v] ?? v ?? "";
export const etichettaMotivo = (v) => ETICHETTE_MOTIVO[v] ?? v ?? "";
export const etichettaAttivita = (v) => ETICHETTE_ATTIVITA[v] ?? v ?? "";

export const statoValido = (v) => v in ETICHETTE_STATO;
export const fonteValida = (v) => v in ETICHETTE_FONTE;
export const motivoValido = (v) => v in ETICHETTE_MOTIVO;

/** Stati da cui un lead non si muove più da solo: non va né ricontattato né contato fra i vivi. */
export const statoChiuso = (stato) => stato === "iscritto" || stato === "perso";

/**
 * I passaggi che si fanno a mano.
 *
 * Tre stati non compaiono mai come destinazione, e non è una dimenticanza: `prova_prenotata`
 * nasce solo prenotando davvero una lezione, `prova_svolta` solo segnando che la persona si
 * è presentata, `iscritto` solo convertendo il lead in socio. Uno stato che si può scegliere
 * da un menu senza che sia successo niente è uno stato che la Dashboard non può credere.
 *
 * `iscritto` è finale: il lead è diventato un socio, e da lì si lavora sul socio. `perso` si
 * riapre, perché capita che chi aveva detto no a settembre torni a gennaio.
 */
const TRANSIZIONI_MANUALI = {
  nuovo: ["contattato", "proposta", "perso"],
  contattato: ["proposta", "perso"],
  prova_prenotata: ["contattato", "proposta", "perso"],
  prova_svolta: ["contattato", "proposta", "perso"],
  proposta: ["contattato", "perso"],
  perso: ["contattato"],
  iscritto: [],
};

export function transizioniManuali(da) {
  return TRANSIZIONI_MANUALI[da] ?? [];
}

export function transizioneConsentita(da, a) {
  return transizioniManuali(da).includes(a);
}

/** Se a un lead in questo stato si può prenotare una prova. */
export function puoPrenotareProva(stato) {
  return statoValido(stato) && !statoChiuso(stato);
}

/** Se un lead in questo stato si può convertire in socio. */
export function puoConvertire(stato) {
  return stato !== "iscritto" && statoValido(stato);
}

/**
 * Lo stato che segue l'esito di una prova.
 *
 * Chi non si presenta torna a "contattato" e non a "perso": saltare una prova è la cosa più
 * normale del mondo, e chiudere il contatto lì vorrebbe dire rinunciare a richiamarlo.
 */
export function statoDopoEsito(presenza) {
  if (presenza === "presente") return "prova_svolta";
  if (presenza === "assente") return "contattato";
  return null;
}

// ---------------------------------------------------------------------------------------
// Conti per la Dashboard e per l'elenco
// ---------------------------------------------------------------------------------------

/** `AAAA-MM-GG` spostata di `giorni`. In UTC, così un cambio d'ora non sposta la data. */
export function spostaData(data, giorni) {
  const [a, m, g] = String(data).split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, g + giorni));
  return d.toISOString().slice(0, 10);
}

const soloData = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Le prove dei lead nelle lezioni fra `oggi` e `oggi + giorni` compreso, raggruppate per corso.
 *
 * Una prova disdetta non è prevista, e nemmeno una di un lead già iscritto: le sue
 * prenotazioni future, convertendolo, sono passate al socio.
 *
 * Restituisce `[{ corso: { id, nome }, prove: [...] }]`, con i corsi ordinati per la prima
 * prova in arrivo e le prove per data e ora.
 */
export function leadPrevistiAiCorsi({ bookings = [], sessions = [], events = [], courses = [], leads = [] }, oggi, giorni = 7) {
  const fine = spostaData(oggi, giorni);
  const lezioni = new Map(sessions.map((s) => [s.id, s]));
  const eventi = new Map(events.map((e) => [e.id, e]));
  const corsi = new Map(courses.map((c) => [c.id, c]));
  const persone = new Map(leads.map((l) => [l.id, l]));

  const gruppi = new Map();
  for (const b of bookings) {
    if (!b.lead_id || b.status === "cancelled") continue;
    const lezione = lezioni.get(b.session_id);
    const data = soloData(lezione?.date);
    if (!data || data < oggi || data > fine) continue;
    if (lezione.status === "cancelled") continue;

    const lead = persone.get(b.lead_id);
    const corso = corsi.get(eventi.get(lezione.event_id)?.course_id);
    const chiave = corso?.id ?? "senza-corso";
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, { corso: { id: corso?.id ?? null, nome: corso?.name ?? "Corso" }, prove: [] });
    }
    gruppi.get(chiave).prove.push({
      booking_id: b.id,
      lead_id: b.lead_id,
      nome: lead?.full_name ?? b.member_name ?? "",
      stato_lead: lead?.stato ?? null,
      data,
      inizio: lezione.start_time ?? null,
      fine: lezione.end_time ?? null,
      stato_prenotazione: b.status,
      presenza: b.presenza ?? null,
    });
  }

  const quando = (p) => `${p.data} ${p.inizio ?? ""}`;
  const risultato = [...gruppi.values()];
  for (const g of risultato) g.prove.sort((a, b) => quando(a).localeCompare(quando(b)));
  return risultato.sort((a, b) => quando(a.prove[0]).localeCompare(quando(b.prove[0])));
}

/**
 * Le prove già passate di cui nessuno ha segnato se la persona è venuta.
 *
 * Senza esito il lead resta in "prova prenotata" per sempre, e la conversione prova → socio
 * diventa un numero inventato: è la prima cosa da sistemare al banco, prima ancora delle
 * prove di domani.
 */
export function proveDaEsitare({ bookings = [], sessions = [] }, oggi) {
  const lezioni = new Map(sessions.map((s) => [s.id, s]));
  return bookings.filter((b) => {
    if (!b.lead_id || b.status !== "confirmed" || b.presenza) return false;
    const data = soloData(lezioni.get(b.session_id)?.date);
    return Boolean(data) && data < oggi;
  });
}

/**
 * I lead su cui qualcuno deve fare qualcosa oggi.
 *
 * Due casi: chi ha una prossima azione scaduta o prevista per oggi, e chi è ancora "nuovo" —
 * un contatto che nessuno ha mai richiamato è il più urgente di tutti, anche senza una data.
 * I nuovi vengono prima, dal più vecchio; poi le azioni, dalla più in ritardo.
 */
export function leadDaRicontattare(leads = [], oggi) {
  const nuovi = [];
  const scaduti = [];
  for (const l of leads) {
    if (statoChiuso(l.stato)) continue;
    const quando = soloData(l.prossima_azione_il);
    if (quando && quando <= oggi) scaduti.push(l);
    // Un nuovo con una data futura l'ha già preso in carico qualcuno: si ripresenta quel giorno.
    else if (!quando && l.stato === "nuovo") nuovi.push(l);
  }
  nuovi.sort((a, b) => String(a.created_date ?? "").localeCompare(String(b.created_date ?? "")));
  scaduti.sort((a, b) => soloData(a.prossima_azione_il).localeCompare(soloData(b.prossima_azione_il)));
  return [...nuovi, ...scaduti];
}

/**
 * Quante prove si sono fatte e quante sono diventate iscrizioni.
 *
 * La conversione si misura sulle persone e non sulle prenotazioni: chi prova due volte e poi
 * si iscrive è una conversione, non mezza.
 */
export function riepilogoProve({ bookings = [], leads = [] }) {
  const persone = new Map(leads.map((l) => [l.id, l]));
  let prenotate = 0;
  let svolte = 0;
  let assenti = 0;
  const conProvaSvolta = new Set();
  for (const b of bookings) {
    if (!b.lead_id || b.status === "cancelled") continue;
    prenotate += 1;
    if (b.presenza === "presente") {
      svolte += 1;
      conProvaSvolta.add(b.lead_id);
    } else if (b.presenza === "assente") {
      assenti += 1;
    }
  }
  const convertite = [...conProvaSvolta].filter((id) => persone.get(id)?.stato === "iscritto").length;
  const conversione = conProvaSvolta.size ? convertite / conProvaSvolta.size : null;
  return { prenotate, svolte, assenti, convertite, conversione };
}
