// Le due sessioni, e il passaggio da quando ce n'era una sola.
//
// Questo test esiste per una ragione precisa: la migrazione gira **una volta sola**, sul
// browser di ogni persona, al primo caricamento dopo il rilascio. Se sbaglia, la scopre
// l'utente trovandosi fuori — e non c'è modo di rifarla. È il tipo di codice che va provato
// prima, non osservato dopo.
//
// Gira con `node --test`, senza browser: `localStorage` qui è un oggetto finto di quindici
// righe. Che sia possibile è esattamente la proprietà che vogliamo da core/.
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Il finto localStorage va messo prima di importare il client, che lo legge al primo uso.
function archivioFinto(iniziale = {}) {
	const dati = new Map(Object.entries(iniziale));
	return {
		getItem: (k) => (dati.has(k) ? dati.get(k) : null),
		setItem: (k, v) => dati.set(k, String(v)),
		removeItem: (k) => dati.delete(k),
		get contenuto() {
			return Object.fromEntries(dati);
		},
	};
}

globalThis.localStorage = archivioFinto();

const { impostaArea, getToken, setToken, migraSessioneVecchia } = await import('./client.js');

const VECCHIA = 'grip_auth_token';
const STAFF = 'grip_staff_token';
const SOCIO = 'grip_member_token';

describe('le due sessioni convivono', () => {
	beforeEach(() => {
		globalThis.localStorage = archivioFinto();
	});

	test('ogni area scrive e rilegge la propria chiave', () => {
		impostaArea('staff');
		setToken('token-dello-staff');
		impostaArea('member');
		setToken('token-del-socio');

		impostaArea('staff');
		assert.equal(getToken(), 'token-dello-staff');
		impostaArea('member');
		assert.equal(getToken(), 'token-del-socio');
	});

	test("uscire da un'area non tocca l'altra", () => {
		impostaArea('staff');
		setToken('token-dello-staff');
		impostaArea('member');
		setToken('token-del-socio');

		impostaArea('member');
		setToken(null);

		assert.equal(getToken(), null);
		impostaArea('staff');
		assert.equal(getToken(), 'token-dello-staff', 'il gestionale doveva restare connesso');
	});

	test("un'area sconosciuta è un errore, non un silenzio", () => {
		assert.throws(() => impostaArea('portineria'), /Area sconosciuta/);
	});
});

describe('la migrazione da quando la chiave era una sola', () => {
	beforeEach(() => {
		globalThis.localStorage = archivioFinto();
	});

	test('chi era connesso resta connesso, in entrambe le aree', () => {
		globalThis.localStorage = archivioFinto({ [VECCHIA]: 'token-di-prima' });

		migraSessioneVecchia();

		const dopo = globalThis.localStorage.contenuto;
		assert.equal(dopo[STAFF], 'token-di-prima');
		assert.equal(dopo[SOCIO], 'token-di-prima');
		assert.ok(!(VECCHIA in dopo), 'la chiave vecchia doveva sparire');
	});

	test('non calpesta sessioni già separate', () => {
		globalThis.localStorage = archivioFinto({
			[VECCHIA]: 'token-di-prima',
			[STAFF]: 'token-nuovo-dello-staff',
		});

		migraSessioneVecchia();

		const dopo = globalThis.localStorage.contenuto;
		assert.equal(dopo[STAFF], 'token-nuovo-dello-staff', 'la sessione in corso è stata sovrascritta');
		assert.ok(!(VECCHIA in dopo), 'il residuo doveva essere ripulito');
	});

	test('senza niente da migrare non inventa sessioni', () => {
		migraSessioneVecchia();
		assert.deepEqual(globalThis.localStorage.contenuto, {});
	});

	test('ripeterla non cambia il risultato', () => {
		globalThis.localStorage = archivioFinto({ [VECCHIA]: 'token-di-prima' });

		migraSessioneVecchia();
		const dopoUna = globalThis.localStorage.contenuto;
		migraSessioneVecchia();

		assert.deepEqual(globalThis.localStorage.contenuto, dopoUna);
	});
});

describe("l'archivio che non si può usare", () => {
	test('in navigazione privata si resta senza sessione, senza esplodere', () => {
		globalThis.localStorage = {
			getItem() {
				throw new Error('accesso negato');
			},
			setItem() {
				throw new Error('accesso negato');
			},
			removeItem() {
				throw new Error('accesso negato');
			},
		};

		impostaArea('member');
		assert.equal(getToken(), null);
		assert.doesNotThrow(() => setToken('qualcosa'));
		assert.doesNotThrow(() => migraSessioneVecchia());
	});
});
