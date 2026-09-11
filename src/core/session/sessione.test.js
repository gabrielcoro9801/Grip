// Le due sessioni, e il passaggio da quando ce n'era una sola.
//
// Questo test esiste per una ragione precisa: la migrazione gira **una volta sola**, sul
// browser di ogni persona, al primo caricamento dopo il rilascio. Se sbaglia, la scopre
// l'utente trovandosi fuori — e non c'è modo di rifarla. È il tipo di codice che va provato
// prima, non osservato dopo.
//
// Gira con `node --test`, senza browser e senza Vite, e senza fingere `localStorage`:
// l'archivio è un parametro, quindi qui se ne passa uno di quindici righe. Che sia possibile
// è esattamente la proprietà che vogliamo da core/ — se un giorno questo file avesse bisogno
// di un browser per girare, vorrebbe dire che core/ ha smesso di essere trasportabile.
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { impostaArchivio } from './archivio.js';
import {
	impostaArea,
	areaAttiva,
	inizializzaSessione,
	getToken,
	setToken,
	azzeraSessionePerTest,
} from './sessione.js';

const VECCHIA = 'grip_auth_token';
const STAFF = 'grip_staff_token';
const SOCIO = 'grip_member_token';

function archivioFinto(iniziale = {}) {
	const dati = new Map(Object.entries(iniziale));
	return {
		async leggi(k) {
			return dati.has(k) ? dati.get(k) : null;
		},
		async scrivi(k, v) {
			dati.set(k, String(v));
		},
		async cancella(k) {
			dati.delete(k);
		},
		get contenuto() {
			return Object.fromEntries(dati);
		},
	};
}

let archivio;
function prepara(iniziale = {}) {
	archivio = archivioFinto(iniziale);
	impostaArchivio(archivio);
	azzeraSessionePerTest();
	return archivio;
}

describe('le due sessioni convivono', () => {
	beforeEach(() => prepara());

	test('ogni area scrive e rilegge la propria chiave', async () => {
		await inizializzaSessione();

		impostaArea('staff');
		setToken('token-dello-staff');
		impostaArea('member');
		setToken('token-del-socio');

		impostaArea('staff');
		assert.equal(getToken(), 'token-dello-staff');
		impostaArea('member');
		assert.equal(getToken(), 'token-del-socio');
	});

	test("uscire da un'area non tocca l'altra", async () => {
		await inizializzaSessione();

		impostaArea('staff');
		setToken('token-dello-staff');
		impostaArea('member');
		setToken('token-del-socio');
		setToken(null);

		assert.equal(getToken(), null);
		impostaArea('staff');
		assert.equal(getToken(), 'token-dello-staff', 'il gestionale doveva restare connesso');
	});

	test('il token finisce davvero nella chiave giusta', async () => {
		await inizializzaSessione();

		impostaArea('member');
		setToken('token-del-socio');
		// La scrittura sull'archivio non si aspetta: si lascia girare il ciclo di eventi.
		await Promise.resolve();

		assert.equal(archivio.contenuto[SOCIO], 'token-del-socio');
		assert.ok(!(STAFF in archivio.contenuto), 'non doveva toccare la chiave dello staff');
	});

	test("un'area sconosciuta è un errore, non un silenzio", () => {
		assert.throws(() => impostaArea('portineria'), /Area sconosciuta/);
		assert.equal(areaAttiva(), 'staff');
	});
});

describe('la migrazione da quando la chiave era una sola', () => {
	test('chi era connesso resta connesso, in entrambe le aree', async () => {
		const a = prepara({ [VECCHIA]: 'token-di-prima' });

		await inizializzaSessione();

		assert.equal(a.contenuto[STAFF], 'token-di-prima');
		assert.equal(a.contenuto[SOCIO], 'token-di-prima');
		assert.ok(!(VECCHIA in a.contenuto), 'la chiave vecchia doveva sparire');

		impostaArea('member');
		assert.equal(getToken(), 'token-di-prima', 'la sessione doveva essere subito in memoria');
	});

	test('non calpesta sessioni già separate', async () => {
		const a = prepara({ [VECCHIA]: 'token-di-prima', [STAFF]: 'token-nuovo-dello-staff' });

		await inizializzaSessione();

		assert.equal(a.contenuto[STAFF], 'token-nuovo-dello-staff', 'la sessione in corso è stata sovrascritta');
		assert.ok(!(VECCHIA in a.contenuto), 'il residuo doveva essere ripulito');
	});

	test('senza niente da migrare non inventa sessioni', async () => {
		const a = prepara();

		await inizializzaSessione();

		assert.deepEqual(a.contenuto, {});
		assert.equal(getToken(), null);
	});

	test('ripeterla non cambia il risultato', async () => {
		const a = prepara({ [VECCHIA]: 'token-di-prima' });

		await inizializzaSessione();
		const dopoUna = { ...a.contenuto };
		await inizializzaSessione();

		assert.deepEqual(a.contenuto, dopoUna);
	});
});

describe("l'archivio che non si può usare", () => {
	test("in navigazione privata si resta senza sessione, ma l'applicazione parte", async () => {
		impostaArchivio({
			async leggi() {
				throw new Error('accesso negato');
			},
			async scrivi() {
				throw new Error('accesso negato');
			},
			async cancella() {
				throw new Error('accesso negato');
			},
		});
		azzeraSessionePerTest();

		// Il punto è questo: `inizializzaSessione` non deve sollevare, altrimenti l'avvio si
		// ferma e resta una pagina bianca.
		await assert.doesNotReject(() => inizializzaSessione());

		impostaArea('member');
		assert.equal(getToken(), null);
		assert.doesNotThrow(() => setToken('qualcosa'));
		// Il token vale comunque per questa visita: è in memoria, solo non verrà ricordato.
		assert.equal(getToken(), 'qualcosa');
	});

	test('un archivio senza i tre metodi viene rifiutato subito', () => {
		assert.throws(() => impostaArchivio({ leggi() {} }), /leggi, scrivi e cancella/);
	});
});
