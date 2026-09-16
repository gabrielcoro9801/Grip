// Dominio CRM/membership: Member, Subscription, Plan, MemberDocument, QRAccesso.
// Campi dedotti dall'uso reale nel codice (il datastore precedente non aveva schema).
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, timestamp, check, uniqueIndex } from 'drizzle-orm/pg-core';

// Anagrafica "socio" applicativo (login member, prenotazioni, documenti, QR).
export const members = pgTable('members', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 120 }).notNull(),
	cognome: varchar('cognome', { length: 120 }).notNull(),
	// Calcolato dal database, non si scrive. Lo leggono una ventina di punti — portale, QR,
	// schede, prenotazioni — e tenerlo come colonna vera avrebbe voluto dire aggiornarlo in
	// ognuno di quei posti, o accettare che un giorno dica un nome diverso da nome e cognome.
	fullName: varchar('full_name', { length: 255 }).generatedAlwaysAs(sql`trim(nome || ' ' || cognome)`),
	// Nullable solo perché i soci registrati prima non lo avevano: l'obbligo lo impone il
	// server su ogni creazione e modifica (entities/hooks.js).
	codiceFiscale: varchar('codice_fiscale', { length: 16 }),
	sesso: varchar('sesso', { length: 8 }), // M | F | altro — vedi shared/anagrafica.js
	email: varchar('email', { length: 255 }),
	phone: varchar('phone', { length: 64 }),
	dateOfBirth: date('date_of_birth'),
	address: text('address'),
	emergencyContactName: varchar('emergency_contact_name', { length: 255 }),
	emergencyContactPhone: varchar('emergency_contact_phone', { length: 64 }),
	gdprConsent: boolean('gdpr_consent').default(false),
	gdprConsentDate: date('gdpr_consent_date'),
	// Il consenso alle comunicazioni promozionali, distinto da quello al trattamento. Oggi non
	// lo scrive nessuno: lo darà il socio dal portale, con una notifica al titolare.
	consensoMarketing: boolean('consenso_marketing').notNull().default(false),
	consensoMarketingData: date('consenso_marketing_data'),
	// Progressivo a 6 cifre (es. "000007"), assegnato dal contatore (lib/codiceSocio.js).
	//
	// È la chiave con cui la palestra riconosce un socio: obbligatorio e univoco. Non è la
	// chiave primaria tecnica — una tabella ne ha una sola, e `id` resta quella a cui puntano
	// abbonamenti, documenti, QR e prenotazioni — ma vale come chiave candidata: nessun socio
	// senza, nessun codice due volte.
	codiceSocio: varchar('codice_socio', { length: 16 }).notNull().unique('members_codice_socio_univoco'),
	// La foto del profilo, facoltativa. Finisce in `_url` di proposito: esce firmata come ogni
	// altro file caricato (entities/hooks.js).
	fotoUrl: text('foto_url'),
	notes: text('notes'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	sessoValido: check('members_sesso_valido', sql`${table.sesso} IS NULL OR ${table.sesso} IN ('M', 'F', 'altro')`),
	codiceFiscaleUnivoco: uniqueIndex('members_codice_fiscale_univoco').on(sql`upper(${table.codiceFiscale})`).where(sql`${table.codiceFiscale} IS NOT NULL`),
}));

// Un tipo di abbonamento del catalogo. Una volta creato non si modifica né si cancella: le
// iscrizioni vendute ne portano il nome e la durata, e cambiarli dopo riscriverebbe la storia.
// Si cambia solo lo stato (entities/hooks.js). Le regole stanno in shared/abbonamenti.js.
export const plans = pgTable('plans', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	price: numeric('price', { precision: 10, scale: 2 }).notNull(),
	// Durata in giorni, mesi o anni: "un mese" scritto come 30 giorni sbagliava le scadenze.
	durataValore: integer('durata_valore').notNull(),
	durataUnita: varchar('durata_unita', { length: 8 }).notNull(), // giorni | mesi | anni
	// L'ultimo giorno in cui il tipo si può vendere; vuoto, senza limite.
	vendibileFinoAl: date('vendibile_fino_al'),
	description: varchar('description', { length: 140 }), // le note: tre righe nella tile
	stato: varchar('stato', { length: 12 }).notNull().default('attivo'), // attivo | sospeso | annullato
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	unitaValida: check('plans_durata_unita_valida', sql`${table.durataUnita} IN ('giorni', 'mesi', 'anni')`),
	durataPositiva: check('plans_durata_positiva', sql`${table.durataValore} > 0`),
	statoValido: check('plans_stato_valido', sql`${table.stato} IN ('attivo', 'sospeso', 'annullato')`),
}));

export const subscriptions = pgTable('subscriptions', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	planId: uuid('plan_id').references(() => plans.id),
	planName: varchar('plan_name', { length: 255 }), // denormalizzato da Plan.name
	startDate: date('start_date').notNull(),
	endDate: date('end_date'),
	status: varchar('status', { length: 16 }).notNull().default('active'), // active | expiring | expired
	pricePaid: numeric('price_paid', { precision: 10, scale: 2 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
});

export const memberDocuments = pgTable('member_documents', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	// Tre tipi, vincolati: prima era testo libero, e la Dashboard cercava "Medical Certificate"
	// mentre il modulo scriveva "Certificato Medico" — l'avviso delle scadenze non è mai
	// scattato. Le etichette sono in shared/anagrafica.js.
	documentType: varchar('document_type', { length: 32 }).notNull(), // certificato_medico | documento_identita | altro
	// Il nome di un documento "altro" (es. "Contratto"): per gli altri due il tipo basta.
	titolo: varchar('titolo', { length: 255 }),
	fileName: varchar('file_name', { length: 255 }),
	fileUrl: text('file_url'),
	expiryDate: date('expiry_date'),
	notes: text('notes'),
	caricatoDa: varchar('caricato_da', { length: 255 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	tipoValido: check('member_documents_tipo_valido', sql`${table.documentType} IN ('certificato_medico', 'documento_identita', 'altro')`),
}));

export const qrAccessi = pgTable('qr_accessi', {
	id: uuid('id').defaultRandom().primaryKey(),
	// Nonostante il nome storico "cliente_id", nel codice punta sempre a members.id.
	clienteId: uuid('cliente_id').notNull().references(() => members.id),
	clienteName: varchar('cliente_name', { length: 255 }),
	codice: varchar('codice', { length: 64 }).notNull().unique(), // formato GRIP-XXXX-XXXX-XXXX-XXXX
	dataGenerazione: timestamp('data_generazione', { withTimezone: true }).notNull().defaultNow(),
	stato: varchar('stato', { length: 16 }).notNull().default('attivo'), // attivo | revocato
});
