// Le comunicazioni automatiche: la coda dei messaggi, i testi della palestra, le credenziali dei
// canali. Le regole stanno in shared/comunicazioni.js; chi accoda e chi spedisce in lib/invii.js.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, timestamp, check, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { organizations } from './common.js';
import { persone } from './persone.js';

// La coda in uscita, e il suo registro: ogni messaggio che un playbook ha deciso di mandare, anche
// quelli simulati o bloccati, così la palestra vede cosa è partito, cosa sarebbe partito e perché
// qualcosa non è partito.
//
// `chiave` è l'idempotenza: palestra, playbook, persona e occasione. La stessa occasione non si
// accoda due volte, comunque si rilanci il giro.
export const messaggi = pgTable('messaggi', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
	personaId: uuid('persona_id').references(() => persone.id, { onDelete: 'cascade' }),
	playbook: varchar('playbook', { length: 32 }).notNull(),
	canale: varchar('canale', { length: 16 }).notNull(),
	// L'indirizzo, il numero o (per il portale) l'id del socio a cui è andato: com'era in quel momento.
	destinatario: varchar('destinatario', { length: 255 }),
	oggetto: varchar('oggetto', { length: 200 }),
	testo: text('testo').notNull(),
	chiave: varchar('chiave', { length: 255 }).notNull(),
	stato: varchar('stato', { length: 20 }).notNull(),
	// Perché è bloccato o non è riuscito, in parole.
	motivo: varchar('motivo', { length: 255 }),
	costoCentesimi: integer('costo_centesimi').notNull().default(0),
	idFornitore: varchar('id_fornitore', { length: 255 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	inviatoIl: timestamp('inviato_il', { withTimezone: true }),
}, (table) => ({
	chiaveUnica: uniqueIndex('messaggi_chiave_unica').on(table.chiave),
	canaleValido: check('messaggi_canale_valido', sql`${table.canale} IN ('app', 'email', 'sms')`),
	statoValido: check('messaggi_stato_valido', sql`${table.stato} IN ('simulato', 'in_coda', 'inviato', 'consegnato', 'fallito', 'bloccato_consenso', 'bloccato_budget', 'bloccato_silenzio')`),
	perPalestra: index('messaggi_organization_id_created_date_idx').on(table.organizationId, table.createdDate),
	perPersona: index('messaggi_persona_id_idx').on(table.personaId),
	// La spedizione cerca solo quelli in coda.
	inCoda: index('messaggi_in_coda_idx').on(table.createdDate).where(sql`${table.stato} = 'in_coda'`),
}));

// I testi che la palestra ha riscritto: uno per playbook e canale. Senza riga vale il testo
// predefinito (shared/comunicazioni.js), che così può migliorare senza toccare quelli scelti.
export const modelliMessaggio = pgTable('modelli_messaggio', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
	playbook: varchar('playbook', { length: 32 }).notNull(),
	canale: varchar('canale', { length: 16 }).notNull(),
	oggetto: varchar('oggetto', { length: 200 }),
	testo: text('testo').notNull(),
	autoreNome: varchar('autore_nome', { length: 255 }).notNull(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	unoPerCanale: uniqueIndex('modelli_messaggio_unico').on(table.organizationId, table.playbook, table.canale),
}));

// Le credenziali dei canali (la password della casella, la chiave di Brevo), cifrate con
// AES-256-GCM (lib/segreti.js). Stanno fuori da `organizations.impostazioni` apposta: le
// impostazioni si leggono e si mostrano, queste non escono mai dal server.
export const segretiCanali = pgTable('segreti_canali', {
	organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
	canale: varchar('canale', { length: 16 }).notNull(),
	cifrato: text('cifrato').notNull(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	pk: primaryKey({ columns: [table.organizationId, table.canale] }),
}));
