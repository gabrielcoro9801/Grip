// Scaffolding comune ai test che devono passare per una rotta HTTP vera — journal entries,
// ordini fornitore, chiusura d'esercizio — invece che chiamare direttamente una funzione.
//
// Senza questo, ogni file di test si sarebbe ricostruito da sé organizzazione, account
// amministratore e piano dei conti: la stessa ripetizione che altrove nel repository si è
// già scelto di evitare (vedi `come()` in permessi-portale-soci.test.js per il lato
// autenticazione). Qui vive la parte che serve *prima* di poter chiamare `come()`.
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import {
	organizations, staffAccounts, chartOfAccounts,
	journalEntries, exerciseClosures, purchaseOrders,
} from '../../src/db/schema/index.js';
import { signToken } from '../../src/auth/tokens.js';

// Il costo dell'hash conta solo fuori dai test: qui serve solo che bcrypt produca un
// hash valido, non che resista a un attacco a forza bruta.
const COSTO_HASH_DI_PROVA = 4;

/**
 * Crea un'organizzazione di prova con un amministratore e un piano dei conti minimo:
 * un conto di liquidità, uno di ricavo e uno di costo — il minimo che serve a costruire
 * una scrittura in partita doppia che quadra e tocca un conto economico.
 *
 * Ritorna anche `pulisci()`, da chiamare in `after`: cancella tutto quello che questo
 * aiuto ha creato, e prima ancora quello che il test vi ha scritto sopra (registrazioni,
 * ordini, chiusure), nell'ordine che le chiavi esterne impongono. Un test che crea le
 * proprie righe contabili non deve occuparsi di ripulirle una per una: `journal_lines` ha
 * la cascata sulla propria registrazione, quindi basta che questa cancelli le registrazioni.
 */
export async function creaFixtureOrganizzazione() {
	const suffisso = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

	const [organizzazione] = await db
		.insert(organizations)
		.values({ nome: `Organizzazione di prova ${suffisso}` })
		.returning();

	const passwordHash = await bcrypt.hash('prova-fixture', COSTO_HASH_DI_PROVA);
	const [admin] = await db
		.insert(staffAccounts)
		.values({
			nome: 'Admin di prova',
			email: `admin.fixture.${suffisso}@test.local`,
			passwordHash,
			ruolo: 'admin',
		})
		.returning();

	const conti = await db
		.insert(chartOfAccounts)
		.values([
			{ organizationId: organizzazione.id, codice: '1.1', nome: 'Cassa di prova', tipoConto: 'attivo', natura: 'dare', ruoloSistema: 'cassa' },
			{ organizationId: organizzazione.id, codice: '5.1', nome: 'Ricavo di prova', tipoConto: 'ricavo', natura: 'avere' },
			{ organizationId: organizzazione.id, codice: '6.1', nome: 'Costo di prova', tipoConto: 'costo', natura: 'dare' },
		])
		.returning();
	const [contoCassa, contoRicavo, contoCosto] = conti;

	async function pulisci() {
		// exercise_closures e purchase_orders puntano a journal_entries senza cascata:
		// vanno via prima, o la delete sotto fallisce per vincolo di chiave esterna.
		await db.delete(exerciseClosures).where(eq(exerciseClosures.organizationId, organizzazione.id));
		await db.delete(purchaseOrders).where(eq(purchaseOrders.organizationId, organizzazione.id));
		// journal_lines ha onDelete: 'cascade' sulla propria registrazione: non va ripulita a parte.
		await db.delete(journalEntries).where(eq(journalEntries.organizationId, organizzazione.id));
		await db.delete(chartOfAccounts).where(eq(chartOfAccounts.organizationId, organizzazione.id));
		await db.delete(staffAccounts).where(eq(staffAccounts.id, admin.id));
		await db.delete(organizations).where(eq(organizations.id, organizzazione.id));
	}

	return {
		organizationId: organizzazione.id,
		admin: { id: admin.id, email: admin.email, token: signToken({ sub: admin.id, ruolo: admin.ruolo }) },
		conti: { cassa: contoCassa, ricavo: contoRicavo, costo: contoCosto },
		pulisci,
	};
}
