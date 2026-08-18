// Entità trasversali: Organization (singleton applicativo, vedi src/hooks/useOrganization.js)
// e AuditLog (log generico, vedi src/lib/auditLog.js).
import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

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
