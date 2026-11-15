export const ROLES = {
  admin: { label: "Administrator", description: "Accesso completo a tutti i moduli" },
  reception: { label: "Reception / Staff", description: "Accesso operativo quotidiano" },
  istruttore: { label: "Istruttore", description: "Lavora sui corsi che tiene" },
  member: { label: "Socio", description: "Portale soci: corsi, prenotazioni, abbonamento" },
};

// Le azioni: `view` vede, `edit` modifica, `suoi` (l'opzione «Istruttore») limita a ciò che
// riguarda i corsi di cui l'utente è istruttore. Ogni modulo dichiara le sue.
export const AZIONI = ["view", "edit", "suoi"];

export const MODULES = {
  dashboard: { label: "Dashboard", azioni: ["view"] },
  crm_members: { label: "Soci", azioni: ["view", "edit"] },
  crm_leads: { label: "Lead", azioni: ["view", "edit"] },
  calendario: { label: "Calendario e lezioni", azioni: ["view", "edit", "suoi"] },
  prenotazioni: { label: "Prenotazioni", azioni: ["view", "edit", "suoi"] },
  corsi: { label: "Corsi e categorie", azioni: ["view", "edit", "suoi"] },
  sale: { label: "Sale", azioni: ["view", "edit"] },
  utenti: { label: "Utenti", azioni: ["view", "edit"] },
  ruoli: { label: "Ruoli", azioni: ["view", "edit"] },
  impostazioni: { label: "Impostazioni", azioni: ["view", "edit"] },
  audit_log: { label: "Registro delle azioni", azioni: ["view"] },
};

/**
 * La matrice di partenza: quali aree vede ogni ruolo.
 *
 * È il valore predefinito, non l'ultima parola. L'ente può ridefinire i propri ruoli, e le
 * definizioni salvate prevalgono su queste. Quello che nessuna configurazione può scavalcare è
 * in LIMITI_INVALICABILI, più sotto.
 */
export const PERMESSI_PREDEFINITI = {
  admin: {
    dashboard: ["view"],
    crm_members: ["view", "edit"],
    crm_leads: ["view", "edit"],
    calendario: ["view", "edit"],
    prenotazioni: ["view", "edit"],
    corsi: ["view", "edit"],
    sale: ["view", "edit"],
    utenti: ["view", "edit"],
    ruoli: ["view", "edit"],
    impostazioni: ["view", "edit"],
    audit_log: ["view"],
  },
  reception: {
    dashboard: ["view"],
    crm_members: ["view", "edit"],
    crm_leads: ["view", "edit"],
    calendario: ["view", "edit"],
    prenotazioni: ["view", "edit"],
    corsi: ["view", "edit"],
    sale: ["view", "edit"],
  },
  // L'istruttore lavora sui corsi che tiene, e basta. Dalla sua pagina di arrivo vede le sezioni
  // che gli spettano; non ha la dashboard.
  istruttore: {
    calendario: ["view", "edit", "suoi"],
    prenotazioni: ["view", "edit", "suoi"],
    corsi: ["view", "suoi"],
  },
  member: {},
};

/**
 * Azioni privilegiate che la matrice modulo → ruolo non sa esprimere. Il catalogo è vuoto da
 * quando le aree che ne avevano non fanno più parte dell'applicazione: il meccanismo resta.
 */
export const CAPACITA = {};

export const NOMI_CAPACITA = Object.keys(CAPACITA);

export const CAPACITA_PREDEFINITE = {
  admin: NOMI_CAPACITA,
  reception: [],
  istruttore: [],
  member: [],
};

// ---------------------------------------------------------------------------------------
// Il limite invalicabile
// ---------------------------------------------------------------------------------------
//
// Queste regole vivono nel codice apposta: non c'è una schermata che le allenta.

/**
 * Il socio non è un ruolo dello staff, è chi entra nel portale. Quello che può leggere è deciso
 * da server/src/auth/memberScope.js, non da questa matrice.
 */
export const RUOLI_NON_CONFIGURABILI = new Set(["member"]);

/**
 * Il ruolo dell'amministratore non si configura: ha tutto, tranne «Istruttore», che non ha
 * senso per chi gestisce l'ente. Così non può perdere la gestione di utenti e ruoli.
 */
export const RUOLO_AMMINISTRATORE = "admin";

/** Applica il limite a una matrice qualunque, da qualunque parte arrivi. */
export function applicaLimiti({ permessi = {}, capacita = {} } = {}) {
  const p = JSON.parse(JSON.stringify(permessi));
  const c = JSON.parse(JSON.stringify(capacita));

  for (const ruolo of RUOLI_NON_CONFIGURABILI) {
    p[ruolo] = {};
    c[ruolo] = [];
  }

  // L'amministratore ha ogni azione di ogni modulo, tranne quelle «Istruttore».
  p[RUOLO_AMMINISTRATORE] = Object.fromEntries(
    Object.entries(MODULES).map(([m, meta]) => [m, meta.azioni.filter((a) => a !== "suoi")]),
  );

  return { permessi: p, capacita: c };
}

// ---------------------------------------------------------------------------------------
// La matrice in uso
// ---------------------------------------------------------------------------------------
//
// Le funzioni di controllo sono chiamate ovunque e in modo sincrono, quindi la matrice vive
// qui come stato del modulo: il server la carica all'avvio, l'interfaccia al login.
//
// ⚠️ Essendo stato di modulo, vale per tutta l'applicazione: va bene finché l'installazione
// serve una sola organizzazione, che è il caso oggi.
let matriceInUso = applicaLimiti({ permessi: PERMESSI_PREDEFINITI, capacita: CAPACITA_PREDEFINITE });

/** Sostituisce la matrice in uso. Il limite viene riapplicato comunque. */
export function impostaMatrice({ permessi, capacita }) {
  matriceInUso = applicaLimiti({
    permessi: permessi ?? PERMESSI_PREDEFINITI,
    capacita: capacita ?? CAPACITA_PREDEFINITE,
  });
  return matriceInUso;
}

/** Torna ai valori predefiniti. Usata dai test e quando non c'è nulla di salvato. */
export function ripristinaMatricePredefinita() {
  return impostaMatrice({ permessi: PERMESSI_PREDEFINITI, capacita: CAPACITA_PREDEFINITE });
}

/** La matrice attualmente applicata, per mostrarla dove si configura. */
export function matriceCorrente() {
  return matriceInUso;
}

export function canAccess(role, module, action = "view") {
  return (matriceInUso.permessi[role]?.[module] ?? []).includes(action);
}

/** Se il ruolo dispone di un'azione privilegiata. */
export function puo(role, capacita) {
  return (matriceInUso.capacita[role] ?? []).includes(capacita);
}

/** Le capacità di un ruolo, per mostrarle dove i ruoli si configurano. */
export function capacitaDi(role) {
  return matriceInUso.capacita[role] ?? [];
}

export function canEdit(role, module) {
  return canAccess(role, module, "edit");
}

/**
 * Se il ruolo lavora solo sui corsi che tiene in quel modulo (l'opzione «Istruttore»). Chi ha
 * «suoi» è limitato a quelli, anche se ha anche la modifica.
 */
export function soloSuoi(role, module) {
  return canAccess(role, module, "suoi");
}

/**
 * Se concedere `azioni` su `modulo` darebbe più di quanto `chi` può dare. «Istruttore» (suoi)
 * restringe, quindi concederlo non è mai un'eccesso. Chi è limitato ai suoi concede solo ruoli
 * limitati allo stesso modo. È la regola di «non concedi ciò che non hai».
 */
export function concedeDiPiu(chi, modulo, azioni) {
  const ampie = azioni.filter((a) => a !== "suoi");
  if (soloSuoi(chi, modulo)) {
    return ampie.length > 0 && (!azioni.includes("suoi") || ampie.some((a) => !canAccess(chi, modulo, a)));
  }
  return ampie.some((a) => !canAccess(chi, modulo, a));
}

/** Se un ruolo ha permessi che chi sta salvando non possiede. */
export function ruoloEccede(chi, ruoloAssegnato) {
  const permessi = matriceInUso.permessi[ruoloAssegnato] ?? {};
  return Object.entries(permessi).some(([modulo, azioni]) => concedeDiPiu(chi, modulo, azioni));
}

/** Mappa percorso sidebar → modulo permesso (null = tutti; un elenco = basta uno dei moduli) */
export const SIDEBAR_PERMISSIONS = {
  // Da fare sono gli avvisi dei soci: la vede chi segue i soci.
  "/da-fare": "crm_members",
  "/": "dashboard",
  "/crm": "crm_members",
  "/lead": "crm_leads",
  "/calendario": ["calendario", "prenotazioni", "corsi"],
  "/admin": ["utenti", "ruoli"],
  "/admin/contatti": "impostazioni",
  "/log-audit": "audit_log",
};
