// Una scrittura confermata è già stata usata per liquidità, scadenzario o dichiarazioni:
// modificarla o cancellarla in place lascerebbe quei posti disallineati senza che nessuno
// se ne accorga. L'endpoint generico delle entità non lo sapeva — PUT e DELETE su
// JournalEntry/JournalLine passavano senza alcun controllo, a differenza del POST, che era
// già bloccato con un messaggio che spiega dove creare una registrazione davvero. Questi
// test verificano che la stessa cosa valga ora anche in modifica e cancellazione, e che le
// bozze restino l'eccezione: sono l'unico percorso esistente per correggere un errore prima
// che la registrazione diventi definitiva.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { journalEntries, journalLines } from '../src/db/schema/index.js';
import { creaFixtureOrganizzazione } from './helpers/fixtureOrganizzazione.js';

let app;
let fixture;
let bozza;
let confermata;
let rigaBozza;
let rigaConfermata;

function come(token, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}`, ...opzioni.headers } });
}

async function creaRegistrazione({ stato }) {
	const [entry] = await db
		.insert(journalEntries)
		.values({
			organizationId: fixture.organizationId,
			dataCompetenza: '2026-03-01',
			descrizione: `Registrazione di prova (${stato})`,
			causale: 'Prova',
			tipoOrigine: 'manuale',
			stato,
			naturaFiscale: 'istituzionale',
		})
		.returning();
	const [riga] = await db
		.insert(journalLines)
		.values({ journalEntryId: entry.id, contoId: fixture.conti.ricavo.id, dare: '0', avere: '10' })
		.returning();
	return { entry, riga };
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	fixture = await creaFixtureOrganizzazione();
	({ entry: bozza, riga: rigaBozza } = await creaRegistrazione({ stato: 'bozza' }));
	({ entry: confermata, riga: rigaConfermata } = await creaRegistrazione({ stato: 'confermata' }));
});

after(async () => {
	await app.close();
	await fixture.pulisci();
	await pool.end();
});

describe('una registrazione confermata', () => {
	test('non si modifica', async () => {
		const res = await come(fixture.admin.token, {
			method: 'PUT',
			url: `/api/entities/JournalEntry/${confermata.id}`,
			payload: { descrizione: 'Tentativo di modifica' },
		});
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /storno/);
	});

	test('non si cancella', async () => {
		const res = await come(fixture.admin.token, {
			method: 'DELETE',
			url: `/api/entities/JournalEntry/${confermata.id}`,
		});
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /storno/);
	});
});

describe('una registrazione ancora in bozza', () => {
	test('si modifica: le bozze restano l\'unico percorso per correggere un errore', async () => {
		const res = await come(fixture.admin.token, {
			method: 'PUT',
			url: `/api/entities/JournalEntry/${bozza.id}`,
			payload: { descrizione: 'Bozza corretta' },
		});
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().descrizione, 'Bozza corretta');
	});

	test('si cancella', async () => {
		const { entry, riga } = await creaRegistrazione({ stato: 'bozza' });
		const res = await come(fixture.admin.token, {
			method: 'DELETE',
			url: `/api/entities/JournalEntry/${entry.id}`,
		});
		assert.equal(res.statusCode, 200, res.body);
		void riga; // la riga segue in cascata: nessuna pulizia a parte da fare qui.
	});
});

describe('una riga contabile non si tocca mai da sola', () => {
	test('non si modifica, nemmeno su una registrazione in bozza', async () => {
		const res = await come(fixture.admin.token, {
			method: 'PUT',
			url: `/api/entities/JournalLine/${rigaBozza.id}`,
			payload: { avere: '99' },
		});
		assert.equal(res.statusCode, 400);
	});

	test('non si cancella, nemmeno su una registrazione in bozza', async () => {
		const res = await come(fixture.admin.token, {
			method: 'DELETE',
			url: `/api/entities/JournalLine/${rigaBozza.id}`,
		});
		assert.equal(res.statusCode, 400);
	});

	test('non si modifica su una registrazione confermata', async () => {
		const res = await come(fixture.admin.token, {
			method: 'PUT',
			url: `/api/entities/JournalLine/${rigaConfermata.id}`,
			payload: { avere: '99' },
		});
		assert.equal(res.statusCode, 400);
	});
});
