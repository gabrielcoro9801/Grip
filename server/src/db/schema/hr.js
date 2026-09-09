// Dominio staff: Collaboratore (anagrafica di chi lavora per l'ente) e StaffAccount
// (login/sessione — da NON confondere con Collaboratore, vedi nota sotto).
import { pgTable, uuid, varchar, text, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './common.js';

export const collaboratori = pgTable('collaboratori', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	nome: varchar('nome', { length: 255 }).notNull(),
	cognome: varchar('cognome', { length: 255 }).notNull(),
	// La colonna è NOT NULL senza valore predefinito in banca dati: resta dichiarata qui
	// perché ometterla farebbe fallire ogni inserimento.
	tipoRapporto: varchar('tipo_rapporto', { length: 32 }).notNull(), // dipendente | collaboratore_sportivo
	ruolo: varchar('ruolo', { length: 255 }), // testo libero (es. "Istruttore"), diverso da staff_accounts.ruolo
	email: varchar('email', { length: 255 }),
	phone: varchar('phone', { length: 64 }),
	hireDate: date('hire_date'),
	notes: text('notes'),
	attivo: boolean('attivo').notNull().default(true),
});

// Account di login per staff e member (ruolo="member"). Tabella di autenticazione,
// separata dall'anagrafica `collaboratori` a cui si collega via linked_collaboratore_id.
//
// Le password sono hashate con bcrypt lato server (colonna password_hash) e non
// escono MAI dall'API: il serializer le rimuove esplicitamente. Il login avviene su
// /api/auth/login e restituisce un JWT con scadenza.
export const staffAccounts = pgTable('staff_accounts', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 255 }).notNull(),
	email: varchar('email', { length: 255 }).notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	ruolo: varchar('ruolo', { length: 32 }).notNull(), // admin | reception | istruttore | member
	attivo: boolean('attivo').notNull().default(true),
	linkedCollaboratoreId: uuid('linked_collaboratore_id').references(() => collaboratori.id),
	linkedMemberId: uuid('linked_member_id'), // FK logica -> members.id (import evitato per non ciclare crm.js->hr.js)
	lastActivityDate: timestamp('last_activity_date', { withTimezone: true }),
});
