// Dominio staff: StaffAccount, gli account di chi entra nel gestionale (e dei soci nel portale).
//
// C'era anche un'anagrafica dei collaboratori, a cui un account si poteva collegare: tolta
// (migrazione 0043). Chi lavora nella struttura è un utente interno e basta.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { members } from './crm.js';

// Account di login per staff e member (ruolo="member").
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
	// L'account del portale di un socio: uno per socio, e verso un socio che esiste. Era solo una
	// colonna, e due account potevano puntare allo stesso socio, o a uno che non c'era più.
	linkedMemberId: uuid('linked_member_id').references(() => members.id),
	lastActivityDate: timestamp('last_activity_date', { withTimezone: true }),
	// Il numero che rende revocabile una sessione.
	//
	// Un token firmato vale finché non scade, e nessuno può fermarlo: se un telefono viene
	// rubato o un account va chiuso, la revoca non ha alcun effetto fino alla scadenza. Con
	// questo numero dentro al token, alzarlo di uno invalida all'istante tutte le sessioni di
	// quell'account — è l'unica forma di "esci da tutti i dispositivi" possibile senza tenere
	// un elenco dei token emessi.
	//
	// Diventa indispensabile il giorno in cui esiste un'app installata: lì le sessioni durano
	// settimane, e sono venti righe che non si aggiungono più volentieri dopo.
	tokenVersion: integer('token_version').notNull().default(1),
	// Vera quando la password l'ha scelta qualcun altro: un amministratore che la reimposta, la
	// reception che la genera per il portale, il primo avvio che la legge da una variabile. Chi
	// l'ha scelta la conosce, quindi finché resta vera l'API risponde solo al cambio password
	// (vedi `app.js`).
	passwordDaCambiare: boolean('password_da_cambiare').notNull().default(false),
}, (table) => ({
	// L'email è unica senza guardare le maiuscole, come la confronta il login: prima potevano
	// esistere "Mario@x.it" e "mario@x.it", e l'accesso ne sceglieva uno a caso.
	emailUnica: uniqueIndex('staff_accounts_email_lower_idx').on(sql`lower(${table.email})`),
	unoPerSocio: uniqueIndex('staff_accounts_linked_member_id_idx').on(table.linkedMemberId),
}));
