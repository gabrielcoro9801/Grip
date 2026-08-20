// Entità trasversali: Organization (singleton applicativo, vedi src/hooks/useOrganization.js)
// e AuditLog (log generico, vedi src/lib/auditLog.js).
import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 255 }).notNull().default('La mia palestra'),
	ragioneSociale: varchar('ragione_sociale', { length: 255 }),
	pivaCf: varchar('piva_cf', { length: 32 }),
	indirizzo: text('indirizzo'),
	logoUrl: text('logo_url'),
	// ⚠️ mai scritti nel codice esplorato, solo letti (receiptEngine.js) — probabilmente
	// impostati a mano fuori dall'app. Da confermare sui dati reali.
	regimeFiscale: varchar('regime_fiscale', { length: 64 }),

	// --- Dati richiesti dalla fattura elettronica.
	// Il tracciato dello SdI distingue quello che qui era accorpato: partita IVA e codice
	// fiscale sono campi separati (un'ASD ha spesso entrambi e diversi fra loro), e la sede
	// va scomposta perché CAP, comune e provincia sono elementi distinti dell'XML.
	// `piva_cf` e `indirizzo` restano: li usano ricevute e PDF, dove il formato libero va bene.
	partitaIva: varchar('partita_iva', { length: 16 }),
	codiceFiscale: varchar('codice_fiscale', { length: 16 }),
	// Codice del tracciato (RF01…RF19), diverso dalla descrizione libera di `regime_fiscale`.
	regimeFiscaleCodice: varchar('regime_fiscale_codice', { length: 4 }),
	indirizzoVia: varchar('indirizzo_via', { length: 60 }),
	indirizzoCivico: varchar('indirizzo_civico', { length: 8 }),
	indirizzoCap: varchar('indirizzo_cap', { length: 5 }),
	indirizzoComune: varchar('indirizzo_comune', { length: 60 }),
	indirizzoProvincia: varchar('indirizzo_provincia', { length: 2 }),
	indirizzoNazione: varchar('indirizzo_nazione', { length: 2 }).default('IT'),
	gestioneIva: boolean('gestione_iva'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

// Log azioni generico (src/lib/auditLog.js). entita_tipo/tipo_azione sono lasciati
// come testo libero (non enum rigido): il codice li tratta come convenzione applicativa
// aperta, non come vincolo di dominio chiuso (vedi report HR/trasversali).
export const auditLogs = pgTable('audit_logs', {
	id: uuid('id').defaultRandom().primaryKey(),
	attoreId: uuid('attore_id'), // FK logica -> staff_accounts.id (nessun vincolo per non bloccare log se lo staff viene rimosso)
	attoreNome: varchar('attore_nome', { length: 255 }).default(''),
	ruoloAttore: varchar('ruolo_attore', { length: 32 }).default(''),
	tipoAzione: varchar('tipo_azione', { length: 64 }).notNull(),
	entitaTipo: varchar('entita_tipo', { length: 64 }).notNull(),
	entitaNome: varchar('entita_nome', { length: 255 }).default(''),
	entitaId: varchar('entita_id', { length: 255 }).default(''),
	dettagli: text('dettagli').default(''),
	valorePrecedente: text('valore_precedente').default(''),
	valoreNuovo: text('valore_nuovo').default(''),
	timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * I ruoli dell'ente e cosa possono fare.
 *
 * La matrice viveva solo nel codice: sei ruoli fissi, uguali per ogni installazione. Vanno
 * bene per una palestra e stanno strette a un'ASD grande, che magari vuole un tesoriere in
 * sola lettura o un segretario che gestisce i soci ma non tocca la contabilità.
 *
 * Quello che resta nel codice — e che nessuna riga qui può scavalcare — è in
 * shared/permissions.js: il socio non riceve mai permessi da questa tabella, e
 * l'amministratore non può perdere la gestione degli utenti, altrimenti un salvataggio
 * sbagliato chiuderebbe la porta dall'esterno senza modo di rientrare.
 */
export const ruoli = pgTable('ruoli', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').notNull().references(() => organizations.id),
	// Il nome tecnico usato nei token e nelle colonne `ruolo`: non cambia mai una volta creato.
	nome: varchar('nome', { length: 32 }).notNull(),
	label: varchar('label', { length: 64 }).notNull(),
	descrizione: text('descrizione'),
	// { modulo: ["view","edit"], … }
	permessi: jsonb('permessi').notNull().default('{}'),
	// ["gestire_personale", …]
	capacita: jsonb('capacita').notNull().default('[]'),
	// I sei ruoli con cui l'applicazione nasce: modificabili, ma non eliminabili, perché
	// gli account esistenti vi fanno riferimento.
	sistema: boolean('sistema').notNull().default(false),
}, (table) => ({
	nomeUnivoco: uniqueIndex('ruoli_nome_univoco').on(table.organizationId, table.nome),
}));
