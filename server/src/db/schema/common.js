// Entità trasversali: Organization (singleton applicativo, vedi src/hooks/useOrganization.js)
// e AuditLog (log generico, vedi src/lib/auditLog.js).
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

// L'intestazione dell'ente: serve a dare un nome e un logo alle schermate.
export const organizations = pgTable('organizations', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 255 }).notNull().default('La mia palestra'),
	ragioneSociale: varchar('ragione_sociale', { length: 255 }),
	pivaCf: varchar('piva_cf', { length: 32 }),
	indirizzo: text('indirizzo'),
	logoUrl: text('logo_url'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

// Contatori dei numeri progressivi, uno per organizzazione e per tipo di documento.
// Incrementarli con un UPDATE che blocca la riga è ciò che rende impossibile assegnare
// due volte lo stesso numero: leggere il massimo esistente e sommare 1, come si faceva
// prima, dà lo stesso numero a due operazioni simultanee.
// `scope` tiene separate le numerazioni: oggi serve al codice socio.
export const numberingCounters = pgTable('numbering_counters', {
	organizationId: uuid('organization_id').notNull().references(() => organizations.id),
	scope: varchar('scope', { length: 32 }).notNull(),
	value: integer('value').notNull().default(0),
}, (table) => ({
	pk: primaryKey({ columns: [table.organizationId, table.scope] }),
}));

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
 * La matrice viveva solo nel codice: ruoli fissi, uguali per ogni installazione. Vanno
 * bene per una palestra e stanno strette a un'ASD grande, che magari vuole un segretario
 * che gestisce i soci ma non tocca i corsi.
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
	// Azioni privilegiate, per nome. Il catalogo è oggi vuoto: vedi shared/permissions.js.
	capacita: jsonb('capacita').notNull().default('[]'),
	// I ruoli con cui l'applicazione nasce: modificabili, ma non eliminabili, perché
	// gli account esistenti vi fanno riferimento.
	sistema: boolean('sistema').notNull().default(false),
}, (table) => ({
	nomeUnivoco: uniqueIndex('ruoli_nome_univoco').on(table.organizationId, table.nome),
}));
