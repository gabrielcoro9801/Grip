// Le comunicazioni automatiche ai soci: canali, playbook, e le regole che decidono se, come e
// quando un messaggio parte.
//
// Un messaggio automatico vale solo se arriva alla persona giusta, al momento giusto, una volta
// sola, e se la palestra ha potuto vederlo prima di accenderlo. Per questo qui non c'è un
// costruttore di flussi: c'è un elenco fisso di playbook, ognuno legato a un segnale del motore
// (shared/segnali.js) — chi va contattato lo dice il motore, non un quinto conto di "chi è in
// scadenza" — più un canale e un testo. E ognuno nasce spento.
//
// Funzioni pure: il server (lib/invii.js) le usa per accodare e il gestionale per mostrare
// l'anteprima. Le date sono giorni 'AAAA-MM-GG' e l'ora quella di Roma, come in giorni.js.
import { oggiIso, oraIso, spostaGiorni } from './giorni.js';

/**
 * I canali, nell'ordine in cui si provano: prima quello che non costa e non disturba (la
 * notifica nel portale), poi l'email, per ultimo l'SMS, che costa e arriva in tasca.
 * `consenso`: il consenso promozionale (shared/consensi.js) che serve per il marketing.
 *
 * Le notifiche push del telefono non ci sono ancora: arriveranno con l'app (o con il Web Push
 * del portale installabile). Fino ad allora "app" è la notifica che il socio trova nel portale.
 */
export const CANALI = [
  { valore: "app", etichetta: "Notifica nel portale", consenso: "marketing_push" },
  { valore: "email", etichetta: "Email", consenso: "marketing_email" },
  { valore: "sms", etichetta: "SMS", consenso: "marketing_sms" },
];
const PER_CANALE = Object.fromEntries(CANALI.map((c) => [c.valore, c]));
export const etichettaCanale = (v) => PER_CANALE[v]?.etichetta ?? v;
const ORDINE_CANALI = CANALI.map((c) => c.valore);

/**
 * Con chi si manda, per canale. L'email ha due strade, scelte dalla palestra: la sua casella
 * (SMTP: costo zero, mittente vero, qualche centinaio al giorno) o un servizio di invio (Brevo:
 * IP puliti, piano gratuito da 300 al giorno). Per gli SMS c'è solo il simulato: un fornitore
 * vero (serve un operatore, e un mittente registrato secondo AGCOM) si aggiunge qui e in
 * server/src/lib/canali/ quando servirà.
 */
export const FORNITORI = {
  app: [],
  email: [
    { valore: "smtp", etichetta: "Casella della palestra (SMTP)", campi: ["mittente", "nome_mittente", "host", "porta", "utente"], segreto: "Password della casella" },
    { valore: "brevo", etichetta: "Brevo (servizio di invio)", campi: ["mittente", "nome_mittente"], segreto: "Chiave API di Brevo" },
  ],
  sms: [
    { valore: "finto", etichetta: "Simulato (nessun fornitore ancora)", campi: ["mittente"], segreto: null },
  ],
};
export const fornitore = (canale, valore) => FORNITORI[canale]?.find((f) => f.valore === valore) ?? null;

/** Gli stati di un messaggio in `messaggi`. */
export const STATI_MESSAGGIO = [
  { valore: "simulato", etichetta: "Simulato", tono: "neutro" },
  { valore: "in_coda", etichetta: "In coda", tono: "info" },
  { valore: "inviato", etichetta: "Inviato", tono: "positivo" },
  { valore: "consegnato", etichetta: "Consegnato", tono: "positivo" },
  { valore: "fallito", etichetta: "Non riuscito", tono: "negativo" },
  { valore: "bloccato_consenso", etichetta: "Bloccato: consenso", tono: "attesa" },
  { valore: "bloccato_budget", etichetta: "Bloccato: budget SMS", tono: "attesa" },
  { valore: "bloccato_silenzio", etichetta: "Bloccato: fascia di silenzio", tono: "attesa" },
];
export const statoMessaggio = (v) => STATI_MESSAGGIO.find((s) => s.valore === v) ?? { valore: v, etichetta: v, tono: "neutro" };

/** I tre stati di un playbook: spento non fa niente, anteprima scrive solo "simulato", attivo invia. */
export const STATI_PLAYBOOK = [
  { valore: "spento", etichetta: "Spento" },
  { valore: "anteprima", etichetta: "Anteprima" },
  { valore: "attivo", etichetta: "Attivo" },
];
export const statoPlaybookValido = (v) => STATI_PLAYBOOK.some((s) => s.valore === v);

// I testi si scrivono una volta e valgono per tutti i canali; l'oggetto serve all'email e al
// titolo della notifica, l'SMS usa solo il testo.
const FIRMA = "\n\n{palestra}";

/**
 * I playbook: un elenco fisso. Prima quelli che tengono i soci (rinnovo, assenza,
 * ambientamento, certificato); il compleanno è promozionale e chiede il consenso.
 * I due "immediati" non vengono dal giro ma da quello che succede: partono appena la lezione è
 * annullata o il socio passa dalla lista d'attesa (la notifica nel portale c'è sempre, questi
 * aggiungono email o SMS).
 *
 * - `tipo`: `servizio` (non serve il consenso promozionale) o `marketing`;
 * - `canali`: quelli che il playbook può usare, provati nell'ordine di CANALI;
 * - `testi`: i testi predefiniti, con i segnaposto fra graffe.
 */
export const PLAYBOOK = [
  {
    codice: "rinnovo", titolo: "Rinnovo", tipo: "servizio", canali: ["app", "email", "sms"],
    quando: "14 e 3 giorni prima della scadenza; 3 giorni dopo, se non ha rinnovato (l'SMS solo a quel punto).",
    testi: {
      oggetto: "Il tuo abbonamento {quando}",
      testo: "Ciao {nome}, il tuo abbonamento {abbonamento} {quando} ({scadenza}). Puoi rinnovarlo in reception, oppure chiedercelo dal portale: {link_rinnovo}" + FIRMA,
      sms: "{palestra}: ciao {nome}, il tuo abbonamento {quando}. Rinnova in reception o dal portale: {link_rinnovo}",
    },
  },
  {
    codice: "assenza", titolo: "Assenza", tipo: "servizio", canali: ["app", "email"],
    quando: "Dopo 21 giorni senza ingressi. Prima, dai 14, lo cerca una persona da Oggi.",
    testi: {
      oggetto: "Ci manchi, {nome}",
      testo: "Ciao {nome}, è un po' che non ti vediamo in palestra. Va tutto bene? Se ti serve una mano per ripartire, passa in reception o rispondi a questo messaggio." + FIRMA,
      sms: "{palestra}: ciao {nome}, è un po' che non ti vediamo. Va tutto bene?",
    },
  },
  {
    codice: "ambientamento", titolo: "Ambientamento", tipo: "servizio", canali: ["app", "email"],
    quando: "Una settimana dopo l'iscrizione.",
    testi: {
      oggetto: "Com'è andata la prima settimana?",
      testo: "Ciao {nome}, è passata la tua prima settimana con noi. Come ti trovi? Se hai dubbi sui corsi o sugli orari, chiedi pure in reception: siamo qui per aiutarti." + FIRMA,
      sms: "{palestra}: ciao {nome}, com'è andata la prima settimana? Per qualunque dubbio chiedi in reception.",
    },
  },
  {
    codice: "certificato", titolo: "Certificato medico", tipo: "servizio", canali: ["app", "email"],
    quando: "30 e 7 giorni prima della scadenza del certificato, e quando è scaduto.",
    testi: {
      oggetto: "Il tuo certificato medico {quando}",
      testo: "Ciao {nome}, il tuo certificato medico {quando} ({scadenza}). Senza un certificato valido non potrai allenarti: portane uno nuovo in reception, o caricalo dal portale." + FIRMA,
      sms: "{palestra}: ciao {nome}, il tuo certificato medico {quando}. Portane uno nuovo in reception.",
    },
  },
  {
    codice: "compleanno", titolo: "Compleanno", tipo: "marketing", canali: ["app", "email"],
    quando: "Il giorno del compleanno. Solo a chi ha dato il consenso per quel canale.",
    testi: {
      oggetto: "Buon compleanno, {nome}!",
      testo: "Ciao {nome}, tanti auguri di buon compleanno da tutta la palestra!" + FIRMA,
      sms: "{palestra}: tanti auguri di buon compleanno, {nome}!",
    },
  },
  {
    codice: "lezione_annullata", titolo: "Lezione annullata", tipo: "servizio", canali: ["email", "sms"], immediato: true,
    quando: "Subito, quando una lezione a cui era prenotato viene annullata. La notifica nel portale parte sempre.",
    testi: {
      oggetto: "{titolo}",
      testo: "Ciao {nome}, {avviso}" + FIRMA,
      sms: "{palestra}: {avviso}",
    },
  },
  {
    codice: "promosso_lista_attesa", titolo: "Posto dalla lista d'attesa", tipo: "servizio", canali: ["email", "sms"], immediato: true,
    quando: "Subito, quando si libera un posto e passa dalla lista d'attesa. La notifica nel portale parte sempre.",
    testi: {
      oggetto: "{titolo}",
      testo: "Ciao {nome}, {avviso}" + FIRMA,
      sms: "{palestra}: {avviso}",
    },
  },
];
const PER_PLAYBOOK = Object.fromEntries(PLAYBOOK.map((p) => [p.codice, p]));
export const playbook = (codice) => PER_PLAYBOOK[codice] ?? null;

/** I segnaposto che un testo può usare, con un esempio per l'anteprima. */
export const SEGNAPOSTO = {
  nome: "Giulia",
  palestra: "La mia palestra",
  abbonamento: "Trimestrale",
  scadenza: "24/10/2026",
  quando: "scade tra 14 giorni",
  link_rinnovo: "https://…/member-portal/abbonamento",
  titolo: "Lezione annullata: Pilates",
  avviso: "la lezione di Pilates di lunedì 12 ottobre alle 18:00 è stata annullata.",
};

/** I segnaposto usati in un testo che non esistono: un errore di battitura non deve uscire così com'è. */
export function segnapostoSconosciuti(testo = "") {
  return [...String(testo).matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).filter((n) => !(n in SEGNAPOSTO));
}

/** Riempie i segnaposto; quelli senza valore restano vuoti, mai con le graffe. */
export function riempi(testo = "", valori = {}) {
  return String(testo).replace(/\{([^{}]+)\}/g, (_, nome) => (valori[nome] ?? "").toString()).replace(/[ \t]{2,}/g, " ").trim();
}

// I limiti di lunghezza: un SMS oltre due parti costa il triplo, un titolo lungo si tronca.
export const LIMITI_TESTO = { oggetto: 160, testo: 2000, sms: 320 };

/** Il testo di un playbook per un canale: quello della palestra se l'ha scritto, sennò il predefinito. */
export function testoPer(codice, canale, modelli = []) {
  const pb = playbook(codice);
  const suo = modelli.find((m) => m.playbook === codice && m.canale === canale);
  if (suo) return { oggetto: suo.oggetto ?? "", testo: suo.testo, personalizzato: true };
  return {
    oggetto: canale === "sms" ? "" : pb.testi.oggetto,
    testo: canale === "sms" ? pb.testi.sms : pb.testi.testo,
    personalizzato: false,
  };
}

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split("-"); return `${g}/${m}/${a}`; };
const tra = (n) => (n === 0 ? "oggi" : n === 1 ? "domani" : `tra ${n} giorni`);

// Le finestre delle occasioni: se il giro salta un giorno, l'occasione si recupera il giorno
// dopo invece di perdersi; la chiave (riferimento) la fa partire una volta sola.
const OCCASIONI_RINNOVO = [
  { soglia: 14, da: 4, a: 14, canali: ["app", "email"] },
  { soglia: 3, da: 0, a: 3, canali: ["app", "email"] },
];
const RINNOVO_DOPO = { soglia: -3, da: -10, a: -3, canali: ["app", "email", "sms"] };
const ASSENZA_GIORNI = 21;
const ASSENZA_FINO = 60; // oltre, il messaggio "ci manchi" non ha più senso: è un ex socio
const OCCASIONI_CERTIFICATO = [{ soglia: 30, da: 8, a: 30 }, { soglia: 7, da: 1, a: 7 }];
const CERTIFICATO_SCADUTO_FINO = 30;

/**
 * L'occasione di un playbook per una persona, oggi: i suoi segnali dicono se è il momento.
 * Un segnale nascosto (un contatto dello staff, un rimando) non fa partire niente: se qualcuno
 * l'ha appena sentito, un messaggio automatico sopra sarebbe di troppo.
 *
 * @param p { segnali (dal motore), nome_proprio, scadenza, abbonamento }
 * @returns { riferimento, canali, valori } | null — il riferimento fa la chiave di idempotenza:
 *   la stessa occasione non riparte, anche se il giro si lancia due volte.
 */
export function occasione(codice, p, oggi) {
  const pb = playbook(codice);
  if (!pb || pb.immediato) return null;
  const vivi = (p.segnali ?? []).filter((s) => s.pubblico === "staff" && !s.nascostoFino);
  const segnale = (c) => vivi.find((s) => s.codice === c);
  const valori = { abbonamento: p.abbonamento ?? "", scadenza: p.scadenza ? dataIt(p.scadenza) : "" };

  switch (codice) {
    case "rinnovo": {
      // Chi ha già chiesto di rinnovare aspetta la reception, non un invito.
      if (segnale("rinnovo_richiesto")) return null;
      const s = segnale("in_scadenza");
      const g = s?.dati?.giorni;
      if (s && g !== null && g !== undefined) {
        const o = OCCASIONI_RINNOVO.find((x) => g >= x.da && g <= x.a);
        if (o) return { riferimento: `${s.dati.iscrizione_id ?? p.scadenza}:${o.soglia}`, canali: o.canali, valori: { ...valori, quando: `scade ${tra(g)}` } };
      }
      const d = segnale("scaduto_recuperabile");
      const gd = d?.dati?.giorni;
      if (d && gd !== null && gd !== undefined && gd >= RINNOVO_DOPO.da && gd <= RINNOVO_DOPO.a) {
        return { riferimento: `${d.dati.iscrizione_id}:${RINNOVO_DOPO.soglia}`, canali: RINNOVO_DOPO.canali, valori: { ...valori, quando: `è scaduto da ${-gd} giorni` } };
      }
      return null;
    }
    case "assenza": {
      const s = segnale("assente");
      const g = s?.dati?.giorni;
      if (!s || !(g >= ASSENZA_GIORNI && g <= ASSENZA_FINO)) return null;
      // Una volta per assenza: il riferimento è il giorno da cui non viene.
      return { riferimento: `dal:${spostaGiorni(oggi, -g)}`, canali: pb.canali, valori };
    }
    case "ambientamento": {
      const s = segnale("ambientamento_giorno_7");
      if (!s) return null;
      return { riferimento: `iscritto:${spostaGiorni(oggi, -(s.dati?.giorni ?? 7))}`, canali: pb.canali, valori };
    }
    case "certificato": {
      const s = segnale("certificato_in_scadenza") ?? segnale("certificato_scaduto");
      const g = s?.dati?.giorni;
      if (!s || g === null || g === undefined) return null;
      const doc = s.dati.documento_id ?? "certificato";
      const scadenzaCert = valoreScadenza(oggi, g);
      if (s.dati.scaduto) {
        if (-g > CERTIFICATO_SCADUTO_FINO) return null;
        return { riferimento: `${doc}:scaduto`, canali: pb.canali, valori: { ...valori, scadenza: scadenzaCert, quando: "è scaduto" } };
      }
      const o = OCCASIONI_CERTIFICATO.find((x) => g >= x.da && g <= x.a);
      if (!o) return null;
      return { riferimento: `${doc}:${o.soglia}`, canali: pb.canali, valori: { ...valori, scadenza: scadenzaCert, quando: `scade ${tra(g)}` } };
    }
    case "compleanno":
      return segnale("compleanno") ? { riferimento: `anno:${oggi.slice(0, 4)}`, canali: pb.canali, valori } : null;
    default:
      return null;
  }
}
const valoreScadenza = (oggi, giorni) => dataIt(spostaGiorni(oggi, giorni));

/** La chiave di idempotenza: la stessa occasione per la stessa persona si accoda una volta sola. */
export function chiaveMessaggio({ palestra, playbook: codice, persona, riferimento, simulato = false }) {
  // Il simulato ha la sua chiave: un'anteprima non deve impedire l'invio vero, quando si accende.
  return `${palestra}:${codice}:${persona}:${riferimento}${simulato ? ":anteprima" : ""}`.slice(0, 255);
}

/**
 * Su quale canale va un messaggio, o perché non va.
 *
 * Si provano i canali del playbook nell'ordine di CANALI (portale → email → SMS) e si prende il
 * primo che si può usare: un messaggio per occasione, mai lo stesso su tre canali.
 *
 * @param d.canali      quelli dell'occasione
 * @param d.pronti      i canali pronti (configurati e verificati) della palestra
 * @param d.recapiti    { app: bool (ha l'accesso al portale), email, sms } — ciò che la persona ha
 * @param d.tipo        'servizio' | 'marketing'
 * @param d.consensi    { marketing_email: { valore }, … } (shared/consensi.js)
 * @param d.minorenne   un minore riceve solo nel portale: non c'è un contatto di riferimento a cui scrivere
 * @param d.smsResidui  quanti SMS il budget del mese permette ancora
 * @returns { canale, stato: 'ok' } | { canale, stato: 'bloccato_consenso'|'bloccato_budget', motivo } | null
 *   null: nessun canale possibile (nessun recapito, nessun canale pronto) — non si scrive niente.
 */
export function scegliCanale({ canali = [], pronti = [], recapiti = {}, tipo = "servizio", consensi = {}, minorenne = false, smsResidui = 0 }) {
  let blocco = null;
  for (const canale of ORDINE_CANALI.filter((c) => canali.includes(c))) {
    if (!pronti.includes(canale) || !recapiti[canale]) continue;
    if (minorenne && canale !== "app") {
      blocco ??= { canale, stato: "bloccato_consenso", motivo: "minorenne: nessun contatto di riferimento a cui scrivere" };
      continue;
    }
    if (tipo === "marketing" && !consensi[PER_CANALE[canale].consenso]?.valore) {
      blocco ??= { canale, stato: "bloccato_consenso", motivo: `senza il consenso: ${PER_CANALE[canale].etichetta.toLowerCase()} promozionali` };
      continue;
    }
    if (canale === "sms" && smsResidui < 1) {
      blocco ??= { canale, stato: "bloccato_budget", motivo: "budget SMS del mese esaurito" };
      continue;
    }
    return { canale, stato: "ok" };
  }
  return blocco;
}

/** Vera se a quell'ora (di Roma) si tace. La fascia può passare la mezzanotte (21 → 9). */
export function inSilenzio(adesso, { dalle = 21, alle = 9 } = {}) {
  const ora = Number(oraIso(adesso).slice(0, 2));
  if (dalle === alle) return false;
  return dalle > alle ? ora >= dalle || ora < alle : ora >= dalle && ora < alle;
}

/** Il mese di un istante a Roma, 'AAAA-MM': il budget SMS si conta per mese. */
export const meseDi = (adesso = new Date()) => oggiIso(adesso).slice(0, 7);

/** Quanti SMS si possono ancora mandare questo mese: il tetto è rigido, nessuno sforamento. */
export function smsResidui({ budgetCentesimi = 0, spesiCentesimi = 0, costoCentesimi = 0 }) {
  if (!(costoCentesimi > 0)) return budgetCentesimi > 0 ? Infinity : 0;
  return Math.max(0, Math.floor((budgetCentesimi - spesiCentesimi) / costoCentesimi));
}

/** Le impostazioni delle comunicazioni di una palestra, fuse con i valori di partenza: tutto spento. */
export function impostazioniComunicazioni(salvate = {}) {
  const s = salvate ?? {};
  return {
    attive: s.attive === true,
    silenzio: {
      dalle: oraValida(s.silenzio?.dalle) ? s.silenzio.dalle : 21,
      alle: oraValida(s.silenzio?.alle) ? s.silenzio.alle : 9,
    },
    // Zero vuol dire nessun SMS: il budget va scelto, non trovato.
    budget_sms_centesimi: intero(s.budget_sms_centesimi, 0),
    costo_sms_centesimi: intero(s.costo_sms_centesimi, 6),
    canali: {
      app: { attivo: s.canali?.app?.attivo === true },
      email: { ...(s.canali?.email ?? {}) },
      sms: { ...(s.canali?.sms ?? {}) },
    },
    playbook: Object.fromEntries(PLAYBOOK.map((p) => [p.codice, statoPlaybookValido(s.playbook?.[p.codice]) ? s.playbook[p.codice] : "spento"])),
    informativa: s.informativa ?? null,
    testi_rivisti: s.testi_rivisti ?? null,
  };
}
const oraValida = (v) => Number.isInteger(v) && v >= 0 && v <= 23;
const intero = (v, predefinito) => (Number.isInteger(v) && v >= 0 ? v : predefinito);

/**
 * L'impronta della configurazione di un canale: la verifica vale per quella. Cambiato il
 * mittente, il server o la password, l'invio di prova va rifatto.
 */
export function improntaCanale(conf = {}, segretoAggiornato = null) {
  const campi = ["fornitore", "mittente", "nome_mittente", "host", "porta", "utente"];
  return JSON.stringify([...campi.map((c) => conf[c] ?? null), segretoAggiornato ? String(segretoAggiornato) : null]);
}

/**
 * A che punto è un canale: `non_configurato` → `da_verificare` → `pronto`.
 *
 * Pronto vuol dire verificato con un invio di prova, su questa configurazione. Una verifica
 * fatta in simulazione vale finché gli invii sono simulati: quando si accendono quelli veri
 * (INVII_REALI) il canale torna da verificare, perché nessuno ha mai visto arrivare niente.
 *
 * @param conf      la configurazione salvata del canale
 * @param segreto   { impostato, aggiornato } — la credenziale (mai il suo valore)
 */
export function statoCanale(canale, conf = {}, { segreto = null, inviiReali = false } = {}) {
  if (canale === "app") return conf.attivo ? "pronto" : "non_configurato";
  const f = fornitore(canale, conf.fornitore);
  if (!f) return "non_configurato";
  if (f.campi.some((c) => !conf[c] && conf[c] !== 0)) return "non_configurato";
  if (f.segreto && !segreto?.impostato) return "non_configurato";
  const v = conf.verificato;
  if (!v || v.impronta !== improntaCanale(conf, segreto?.aggiornato)) return "da_verificare";
  if (inviiReali && !v.reale) return "da_verificare";
  return "pronto";
}

/**
 * La lista di controllo prima dell'interruttore generale. Finché non è tutta spuntata, le
 * comunicazioni non si accendono.
 */
export function listaDiControllo({ statiCanali = {}, informativa = null, testiRivisti = null }) {
  const voci = [
    { codice: "canale", etichetta: "Almeno un canale pronto", fatta: Object.values(statiCanali).includes("pronto") },
    { codice: "informativa", etichetta: "Informativa privacy aggiornata con le comunicazioni ai soci", fatta: Boolean(informativa) },
    { codice: "testi", etichetta: "Testi dei playbook riletti", fatta: Boolean(testiRivisti) },
  ];
  return { voci, completa: voci.every((v) => v.fatta) };
}

/** Un mittente SMS alfanumerico: fino a 11 caratteri, lettere e cifre (le regole degli operatori). */
export const mittenteSmsValido = (v) => /^[A-Za-z0-9 ]{1,11}$/.test(String(v ?? "")) && /[A-Za-z]/.test(String(v));

export const emailValida = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
