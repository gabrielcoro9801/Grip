export const ROLES = {
  admin: { label: "Admin generale", description: "Accesso completo a tutti i moduli" },
  reception: { label: "Reception / Staff", description: "Accesso operativo quotidiano" },
  istruttore: { label: "Istruttore", description: "Accesso limitato ai propri corsi" },
  member: { label: "Socio", description: "Portale soci: documenti, abbonamento, QR" },
};

export const MODULES = {
  crm_members: { label: "CRM — Anagrafiche clienti" },
  crm_documents: { label: "CRM — Documenti/certificati" },
  crm_plans: { label: "CRM — Piani di allenamento" },
  calendar: { label: "Calendario & Prenotazioni" },
  admin_users: { label: "Admin & Profili" },
  audit_log: { label: "Log accessi / azioni" },
};

/**
 * La matrice di partenza: quali aree vede ogni ruolo.
 *
 * È il valore predefinito, non l'ultima parola. L'ente può ridefinire i propri ruoli — una
 * ASD grande vuole un tesoriere in sola lettura, una piccola non ha nemmeno il PT — e le
 * definizioni salvate prevalgono su queste. Quello che nessuna configurazione può
 * scavalcare è in LIMITI_INVALICABILI, più sotto.
 */
export const PERMESSI_PREDEFINITI = {
  admin: {
    crm_members: ["view", "edit"],
    crm_documents: ["view", "edit"],
    crm_plans: ["view", "edit"],
    calendar: ["view", "edit"],
    admin_users: ["view", "edit"],
    audit_log: ["view"],
  },
  reception: {
    crm_members: ["view", "edit"],
    crm_documents: ["view", "edit"],
    crm_plans: ["view"],
    calendar: ["view", "edit"],
    admin_users: [],
    audit_log: [],
  },
  istruttore: {
    crm_members: ["view"],
    crm_documents: ["view"],
    crm_plans: ["view", "edit"],
    calendar: ["view", "edit"],
    admin_users: [],
    audit_log: [],
  },
  member: {},
};

/**
 * Azioni privilegiate che la matrice modulo → ruolo non sa esprimere.
 *
 * La matrice dice *a quali aree* un ruolo accede, e per la maggior parte dei casi basta.
 * Non basta però quando due ruoli usano la stessa area per fare cose diverse: un
 * dipendente e un amministratore entrano entrambi in "Personale", ma il primo guarda le
 * proprie timbrature e il secondo quelle di tutti e approva le ferie. Sulla matrice
 * risultano identici.
 *
 * Prima questa distinzione era scritta nelle pagine come `ruolo === "admin"`, in quattordici
 * punti: aggiungere un ruolo significava andarli a cercare uno per uno, e dimenticarne uno
 * significava mostrare a qualcuno un pulsante che non gli spetta. Qui hanno un nome e un
 * posto solo.
 */
// Il catalogo è vuoto da quando le aree che avevano azioni privilegiate — contabilità,
// documenti fiscali, gestione del personale — non fanno più parte dell'applicazione. Il
// meccanismo resta: serve al primo modulo che tornerà ad avere un'azione di questo tipo.
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
// I ruoli sono configurabili dall'ente: è quello che serve per vendere l'applicazione ad
// associazioni diverse, che hanno organigrammi diversi. Una matrice interamente
// configurabile è però anche il modo più facile per aprire un buco con una spunta sbagliata,
// e i due casi qui sotto non sono errori che ci si può permettere di scoprire dopo.
//
// Queste regole vivono nel codice apposta: non c'è una schermata che le allenta.

/**
 * Il socio non è un ruolo dello staff, è chi entra nel portale.
 *
 * Quello che può leggere è deciso da server/src/auth/memberScope.js, non da questa matrice,
 * ed è il confine che una volta lasciava passare i cedolini di tutti. Concedergli un modulo
 * dello staff da una schermata di configurazione significherebbe riaprire quella falla con
 * un clic, quindi qui non gli si concede mai niente, comunque sia configurato.
 */
export const RUOLI_NON_CONFIGURABILI = new Set(["member"]);

/**
 * L'amministratore non può perdere la gestione degli utenti.
 *
 * Senza questa garanzia, un salvataggio sbagliato toglierebbe a tutti l'accesso alla
 * schermata da cui si assegnano i permessi — e non ci sarebbe più modo di rimediare
 * dall'applicazione. È una porta che deve restare aperta dall'interno.
 */
export const PRESIDIO_AMMINISTRATORE = { ruolo: "admin", modulo: "admin_users", azioni: ["view", "edit"] };

/**
 * Applica il limite a una matrice qualunque, da qualunque parte arrivi.
 *
 * Si chiama sia quando si salvano i ruoli sia quando si caricano: fidarsi di ciò che è già
 * in banca dati significherebbe che una riga scritta a mano scavalca il limite.
 */
export function applicaLimiti({ permessi = {}, capacita = {} } = {}) {
  const p = JSON.parse(JSON.stringify(permessi));
  const c = JSON.parse(JSON.stringify(capacita));

  for (const ruolo of RUOLI_NON_CONFIGURABILI) {
    p[ruolo] = {};
    c[ruolo] = [];
  }

  const { ruolo, modulo, azioni } = PRESIDIO_AMMINISTRATORE;
  p[ruolo] = { ...(p[ruolo] ?? {}) };
  p[ruolo][modulo] = [...new Set([...(p[ruolo][modulo] ?? []), ...azioni])];

  return { permessi: p, capacita: c };
}

// ---------------------------------------------------------------------------------------
// La matrice in uso
// ---------------------------------------------------------------------------------------
//
// Le funzioni di controllo sono chiamate ovunque e in modo sincrono, quindi la matrice vive
// qui come stato del modulo: il server la carica all'avvio, l'interfaccia al login, e
// entrambi partono dai valori predefiniti finché non l'hanno fatto.
//
// ⚠️ Essendo stato di modulo, vale per tutta l'applicazione: va bene finché l'installazione
// serve una sola organizzazione, che è il caso oggi. Servendone più d'una andrebbe legata
// alla richiesta.
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

/** Mappa percorso sidebar → modulo permesso (null = tutti i ruoli) */
export const SIDEBAR_PERMISSIONS = {
  "/": null,
  "/crm": "crm_members",
  "/calendario": "calendar",
  "/admin": "admin_users",
  "/log-audit": "audit_log",
};