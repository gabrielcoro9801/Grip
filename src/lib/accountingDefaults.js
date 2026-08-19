import { api } from "@/api/client";

export const DEFAULT_CHART_OF_ACCOUNTS = [
  { codice: "1.1", nome: "Attrezzature sportive", tipo_conto: "attivo", natura: "dare" },
  { codice: "1.2", nome: "Impianti e macchinari", tipo_conto: "attivo", natura: "dare" },
  { codice: "1.3", nome: "Arredi", tipo_conto: "attivo", natura: "dare" },
  { codice: "1.9", nome: "Fondo ammortamento", tipo_conto: "attivo", natura: "avere" },
  { codice: "2.1", nome: "Cassa", tipo_conto: "attivo", natura: "dare" },
  { codice: "2.2", nome: "Banca c/c", tipo_conto: "attivo", natura: "dare" },
  { codice: "3.1", nome: "Crediti v/clienti", tipo_conto: "attivo", natura: "dare" },
  { codice: "3.2", nome: "Crediti v/PT", tipo_conto: "attivo", natura: "dare" },
  { codice: "3.9", nome: "IVA a credito", tipo_conto: "attivo", natura: "dare", gestisce_iva: true },
  { codice: "4.1", nome: "Debiti v/fornitori", tipo_conto: "passivo", natura: "avere" },
  { codice: "4.2", nome: "Debiti v/banche", tipo_conto: "passivo", natura: "avere" },
  { codice: "4.3", nome: "IVA a debito", tipo_conto: "passivo", natura: "avere", gestisce_iva: true },
  // Il lordo del cedolino si divide fra chi lo riceve davvero e chi lo riceve al posto suo:
  // il netto al dipendente, l'IRPEF all'erario, i contributi all'INPS, la cessione del
  // quinto alla finanziaria. Sono debiti distinti, con scadenze e destinatari diversi.
  { codice: "4.4", nome: "Dipendenti c/retribuzioni", tipo_conto: "passivo", natura: "avere" },
  { codice: "4.5", nome: "Erario c/ritenute dipendenti", tipo_conto: "passivo", natura: "avere" },
  { codice: "4.6", nome: "INPS c/contributi", tipo_conto: "passivo", natura: "avere" },
  // Il TFR maturato e non ancora liquidato: si accumula fino alla cessazione del rapporto,
  // a meno che il dipendente lo destini a un fondo pensione, nel qual caso viene versato.
  { codice: "4.7", nome: "Fondo TFR", tipo_conto: "passivo", natura: "avere" },
  { codice: "4.8", nome: "INAIL c/premi", tipo_conto: "passivo", natura: "avere" },
  // Trattenute operate sul netto e girate a terzi: cessione del quinto, quote sindacali,
  // pignoramenti. Non sono un costo dell'ente, sono denaro del dipendente che transita.
  { codice: "4.9", nome: "Terzi c/trattenute", tipo_conto: "passivo", natura: "avere" },
  // Tenuta distinta da 4.5 perché nell'F24 sono codici tributo diversi: sapere quanto è
  // ritenuta su lavoro autonomo e quanto su lavoro dipendente serve a compilarlo.
  { codice: "4.10", nome: "Erario c/ritenute lavoro autonomo", tipo_conto: "passivo", natura: "avere" },
  { codice: "5.1", nome: "Capitale sociale", tipo_conto: "patrimonio_netto", natura: "avere" },
  { codice: "5.2", nome: "Utili/perdite a nuovo", tipo_conto: "patrimonio_netto", natura: "avere" },
  { codice: "6.1", nome: "Ricavi — Abbonamenti/quote", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.2", nome: "Ricavi — Corsi/lezioni", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.3", nome: "Ricavi — PT privati", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.4", nome: "Ricavi — Vendita prodotti", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.5", nome: "Altri ricavi", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.6", nome: "Ricavi da locazione spazi", tipo_conto: "ricavo", natura: "avere" },
  { codice: "6.7", nome: "Plusvalenze patrimoniali", tipo_conto: "ricavo", natura: "avere" },
  { codice: "7.1", nome: "Affitti e locazioni", tipo_conto: "costo", natura: "dare" },
  { codice: "7.2", nome: "Utenze", tipo_conto: "costo", natura: "dare" },
  { codice: "7.3", nome: "Fornitori vari", tipo_conto: "costo", natura: "dare" },
  { codice: "7.4", nome: "Ammortamenti", tipo_conto: "costo", natura: "dare" },
  { codice: "7.5", nome: "Interessi passivi", tipo_conto: "costo", natura: "dare" },
  { codice: "7.6", nome: "Salari e stipendi", tipo_conto: "costo", natura: "dare" },
  { codice: "7.7", nome: "Spese generali", tipo_conto: "costo", natura: "dare" },
  { codice: "7.8", nome: "Compensi amministratori", tipo_conto: "costo", natura: "dare" },
  { codice: "7.9", nome: "Minusvalenze patrimoniali", tipo_conto: "costo", natura: "dare" },
  // Costi del personale che nel cedolino non compaiono, perché non riguardano il dipendente
  // ma restano a carico dell'ente. Tenerli separati dal lordo è ciò che rende leggibile
  // quanto costa davvero una persona.
  { codice: "7.10", nome: "Oneri sociali", tipo_conto: "costo", natura: "dare" },
  { codice: "7.11", nome: "Accantonamento TFR", tipo_conto: "costo", natura: "dare" },
  { codice: "7.12", nome: "Premio INAIL", tipo_conto: "costo", natura: "dare" },
];

// Definizione causali di sistema: codice_conto → lookup by codice
export const DEFAULT_CAUSALI = [
  // ENTRATE
  { nome_visibile: "Incasso abbonamento/quota", tipo: "entrata", icona: "ticket", conto: "6.1", richiede_controparte: true, tipo_controparte: "cliente", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "3.1", puo_essere_istituzionale: true },
  { nome_visibile: "Incasso corso collettivo", tipo: "entrata", icona: "users", conto: "6.2", richiede_controparte: true, tipo_controparte: "cliente", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "3.1", puo_essere_istituzionale: true },
  { nome_visibile: "Incasso PT privato", tipo: "entrata", icona: "dumbbell", conto: "6.3", richiede_controparte: true, tipo_controparte: "cliente", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "3.1", puo_essere_istituzionale: true },
  { nome_visibile: "Vendita prodotto", tipo: "entrata", icona: "package", conto: "6.4", richiede_controparte: false, gestisce_iva: true, iva: 22, permette_a_credito: false },
  { nome_visibile: "Incasso locazione sala", tipo: "entrata", icona: "building", conto: "6.6", richiede_controparte: true, tipo_controparte: "cliente", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "3.1" },
  { nome_visibile: "Altra entrata", tipo: "entrata", icona: "plus-circle", conto: "6.5", richiede_controparte: false, gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "3.1" },
  // USCITE
  { nome_visibile: "Pagamento affitto", tipo: "uscita", icona: "home", conto: "7.1", richiede_controparte: true, tipo_controparte: "fornitore", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "4.1" },
  { nome_visibile: "Pagamento utenza", tipo: "uscita", icona: "zap", conto: "7.2", richiede_controparte: true, tipo_controparte: "fornitore", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "4.1" },
  { nome_visibile: "Pagamento fornitore", tipo: "uscita", icona: "truck", conto: "7.3", richiede_controparte: true, tipo_controparte: "fornitore", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "4.1" },
  { nome_visibile: "Acquisto attrezzatura", tipo: "uscita", icona: "package", conto: "1.1", richiede_controparte: true, tipo_controparte: "fornitore", gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "4.1" },
  { nome_visibile: "Pagamento rata prestito", tipo: "uscita", icona: "landmark", conto: "7.5", richiede_controparte: false, gestisce_iva: false, iva: 0, permette_a_credito: false },
  { nome_visibile: "Pagamento stipendi", tipo: "uscita", icona: "users", conto: "7.6", richiede_controparte: false, gestisce_iva: false, iva: 0, permette_a_credito: false },
  { nome_visibile: "Compensi amministratori", tipo: "uscita", icona: "briefcase", conto: "7.8", richiede_controparte: false, gestisce_iva: false, iva: 0, permette_a_credito: false },
  { nome_visibile: "Altra uscita", tipo: "uscita", icona: "minus-circle", conto: "7.7", richiede_controparte: false, gestisce_iva: true, iva: 22, permette_a_credito: true, conto_credito: "4.1" },
];

export async function seedChartOfAccounts(organizationId) {
  const existing = await api.entities.ChartOfAccount.filter({ organization_id: organizationId });
  const existingCodici = new Set(existing.map(a => a.codice));
  const missing = DEFAULT_CHART_OF_ACCOUNTS.filter(acc => !existingCodici.has(acc.codice));
  if (missing.length > 0) {
    const created = await api.entities.ChartOfAccount.bulkCreate(
      missing.map(acc => ({
        ...acc,
        organization_id: organizationId,
        sistema: true,
        attivo: true,
        gestisce_iva: acc.gestisce_iva || false,
      }))
    );
    return [...existing, ...created];
  }
  return existing;
}

export async function seedCausaliOperative(organizationId, accounts) {
  const existing = await api.entities.CausaleOperativa.filter({ organization_id: organizationId });
  if (existing.length > 0) return existing;

  const findAccount = (codice) => accounts.find(a => a.codice === codice);

  const causaliData = DEFAULT_CAUSALI.map(c => ({
    organization_id: organizationId,
    nome_visibile: c.nome_visibile,
    tipo: c.tipo,
    icona: c.icona,
    conto_contropartita_id: findAccount(c.conto)?.id,
    richiede_controparte: c.richiede_controparte || false,
    tipo_controparte: c.tipo_controparte,
    gestisce_iva: c.gestisce_iva ?? true,
    aliquota_iva_default: c.iva ?? 22,
    permette_a_credito: c.permette_a_credito || false,
    puo_essere_istituzionale: c.puo_essere_istituzionale || false,
    conto_credito_debito_id: c.conto_credito ? findAccount(c.conto_credito)?.id : undefined,
    sistema: true,
    attivo: true,
  })).filter(c => c.conto_contropartita_id);

  return await api.entities.CausaleOperativa.bulkCreate(causaliData);
}