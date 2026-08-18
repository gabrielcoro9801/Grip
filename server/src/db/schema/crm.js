// Dominio CRM/membership: Member, Client, Subscription, Plan, MemberDocument, QRAccesso.
// Campi dedotti dall'uso reale nel codice (il datastore precedente non aveva schema).
// Vedi il report "Data dictionary: CRM + Fiscale entities" per le citazioni file:riga.
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './common.js';

// Anagrafica "socio" applicativo (login member, prenotazioni, documenti, QR).
export const members = pgTable('members', {
	id: uuid('id').defaultRandom().primaryKey(),
	// FK verso clients: ogni Member viene creato insieme a un Client "gemello" collegato.
	clienteId: uuid('cliente_id').references(() => clients.id),
	fullName: varchar('full_name', { length: 255 }).notNull(),
	email: varchar('email', { length: 255 }),
	phone: varchar('phone', { length: 64 }),
	dateOfBirth: date('date_of_birth'),
	address: text('address'),
	emergencyContactName: varchar('emergency_contact_name', { length: 255 }),
	emergencyContactPhone: varchar('emergency_contact_phone', { length: 64 }),
	gdprConsent: boolean('gdpr_consent').default(false),
	gdprConsentDate: date('gdpr_consent_date'),
	// Progressivo a 6 cifre (es. "000007"), generato lato applicazione oggi — da
	// sostituire con una SEQUENCE per organizzazione per evitare race condition.
	codiceSocio: varchar('codice_socio', { length: 16 }),
	notes: text('notes'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

// Anagrafica "cliente" contabile/fiscale (privato o azienda), usata come controparte
// nei movimenti contabili e come base per il Member.
export const clients = pgTable('clients', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	tipo: varchar('tipo', { length: 16 }).notNull(), // 'privato' | 'azienda'
	nome: varchar('nome', { length: 255 }),
	cognome: varchar('cognome', { length: 255 }),
	ragioneSociale: varchar('ragione_sociale', { length: 255 }),
	email: varchar('email', { length: 255 }),
	telefono: varchar('telefono', { length: 64 }),
	codiceFiscalePiva: varchar('codice_fiscale_piva', { length: 32 }),
	note: text('note'),
	attivo: boolean('attivo').notNull().default(true),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable('plans', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	price: numeric('price', { precision: 10, scale: 2 }).notNull(),
	durationDays: integer('duration_days').notNull(),
	sessionsIncluded: integer('sessions_included').notNull().default(999), // 999 = illimitato
	description: text('description'),
	isActive: boolean('is_active').notNull().default(true),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	planId: uuid('plan_id').references(() => plans.id),
	planName: varchar('plan_name', { length: 255 }), // denormalizzato da Plan.name
	startDate: date('start_date').notNull(),
	endDate: date('end_date'),
	status: varchar('status', { length: 16 }).notNull().default('active'), // active | expiring | expired
	sessionsRemaining: integer('sessions_remaining').default(999),
	pricePaid: numeric('price_paid', { precision: 10, scale: 2 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

export const memberDocuments = pgTable('member_documents', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	// ⚠️ valori osservati in italiano nel form corrente ma inglese in un filtro Dashboard
	// ("Medical Certificate") — probabile incoerenza storica dei dati, non un vincolo DB.
	documentType: varchar('document_type', { length: 64 }),
	fileName: varchar('file_name', { length: 255 }),
	fileUrl: text('file_url'),
	expiryDate: date('expiry_date'),
	notes: text('notes'),
	caricatoDa: varchar('caricato_da', { length: 255 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const qrAccessi = pgTable('qr_accessi', {
	id: uuid('id').defaultRandom().primaryKey(),
	// Nonostante il nome storico "cliente_id", nel codice punta sempre a members.id.
	clienteId: uuid('cliente_id').notNull().references(() => members.id),
	clienteName: varchar('cliente_name', { length: 255 }),
	codice: varchar('codice', { length: 64 }).notNull().unique(), // formato GRIP-XXXX-XXXX-XXXX-XXXX
	dataGenerazione: timestamp('data_generazione', { withTimezone: true }).notNull().defaultNow(),
	stato: varchar('stato', { length: 16 }).notNull().default('attivo'), // attivo | revocato
});
