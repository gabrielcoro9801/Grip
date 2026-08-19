export const ROLES = {
  admin: { label: "Admin generale", description: "Accesso completo a tutti i moduli" },
  reception: { label: "Reception / Staff", description: "Accesso operativo quotidiano" },
  istruttore: { label: "Istruttore", description: "Accesso limitato ai propri corsi" },
  pt: { label: "PT esterno", description: "Portale PT: clienti, sedute, compensi" },
  dipendente: { label: "Dipendente", description: "Portale dipendenti: timbratura, turni, ferie" },
  member: { label: "Cliente", description: "Portale cliente: documenti, abbonamento, ricevute, QR" },
};

export const MODULES = {
  crm_members: { label: "CRM — Anagrafiche clienti" },
  crm_documents: { label: "CRM — Documenti/certificati" },
  crm_plans: { label: "CRM — Piani di allenamento" },
  movimenti: { label: "Movimenti" },
  finance: { label: "Contabilità avanzata" },
  acquisti: { label: "Acquisti" },
  vendite: { label: "Vendite" },
  crediti_debiti: { label: "Crediti e Debiti" },
  calendar: { label: "Calendario & Prenotazioni" },
  suppliers: { label: "Fornitori" },
  personale: { label: "Personale (portale)" },
  pt_esterni: { label: "PT Esterni" },
  team: { label: "Team" },
  admin_users: { label: "Admin & Profili" },
  audit_log: { label: "Log accessi / azioni" },
  receipt_template: { label: "Template ricevuta" },
  fiscal_profile: { label: "Profilo fiscale ente" },
};

export const PERMISSIONS = {
  admin: {
    crm_members: ["view", "edit"],
    crm_documents: ["view", "edit"],
    crm_plans: ["view", "edit"],
    movimenti: ["view", "edit"],
    finance: ["view", "edit"],
    acquisti: ["view", "edit"],
    vendite: ["view", "edit"],
    crediti_debiti: ["view", "edit"],
    calendar: ["view", "edit"],
    suppliers: ["view", "edit"],
    personale: ["view", "edit"],
    pt_esterni: ["view", "edit"],
    team: ["view", "edit"],
    admin_users: ["view", "edit"],
    audit_log: ["view"],
    receipt_template: ["view", "edit"],
    fiscal_profile: ["view", "edit"],
  },
  reception: {
    crm_members: ["view", "edit"],
    crm_documents: ["view", "edit"],
    crm_plans: ["view"],
    movimenti: ["view", "edit"],
    finance: [],
    acquisti: ["view", "edit"],
    vendite: ["view", "edit"],
    crediti_debiti: ["view", "edit"],
    calendar: ["view", "edit"],
    suppliers: ["view"],
    personale: ["view"],
    pt_esterni: ["view"],
    admin_users: [],
    audit_log: [],
    receipt_template: [],
  },
  istruttore: {
    crm_members: ["view"],
    crm_documents: ["view"],
    crm_plans: ["view", "edit"],
    movimenti: ["view", "edit"],
    finance: [],
    acquisti: ["view"],
    vendite: ["view", "edit"],
    crediti_debiti: ["view"],
    calendar: ["view", "edit"],
    suppliers: [],
    personale: [],
    pt_esterni: [],
    admin_users: [],
    audit_log: [],
    receipt_template: [],
  },
  pt: {
    crm_members: ["view"],
    crm_documents: ["view"],
    crm_plans: ["view", "edit"],
    movimenti: ["view", "edit"],
    finance: [],
    acquisti: ["view"],
    crediti_debiti: ["view"],
    calendar: ["view", "edit"],
    suppliers: [],
    admin_users: [],
    audit_log: [],
    receipt_template: [],
    vendite: ["view", "edit"],
    personale: [],
    pt_esterni: ["view", "edit"],
  },
  dipendente: {
    personale: ["view", "edit"],
    pt_esterni: [],
  },
  member: {},
};

export function canAccess(role, module, action = "view") {
  const perms = PERMISSIONS[role]?.[module] || [];
  return perms.includes(action);
}

export function canEdit(role, module) {
  return canAccess(role, module, "edit");
}

/** Mappa percorso sidebar → modulo permesso (null = tutti i ruoli) */
export const SIDEBAR_PERMISSIONS = {
  "/": null,
  "/crm": "crm_members",
  "/movimenti": "movimenti",
  "/vendite": "vendite",
  "/finance": "finance",
  "/calendar": "calendar",
  "/personale": "personale",
  "/pt": "pt_esterni",
  "/team": "team",
  "/contabilita": "finance",
  "/admin": "admin_users",
  "/audit-log": "audit_log",
  "/receipt-template": "receipt_template",
  "/profilo-fiscale": "fiscal_profile",
};