// Chi può scrivere cosa, dal lato che conta.
//
// La matrice ruolo → modulo esisteva nell'interfaccia molto prima che sul server: per un
// periodo un istruttore che poteva solo *vedere* le anagrafiche riusciva comunque a
// modificarle chiamando l'API a mano, perché le entità non elencate erano scrivibili da
// chiunque fosse autenticato. Questi controlli girano contro le funzioni vere.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { canWriteEntity, haRegolaDiScrittura } from '../src/auth/authorize.js';
import { ENTITY_NAMES } from '../src/entities/registry.js';

describe('nessuna entità resta senza una decisione', () => {
	test('ogni entità del registro ha una regola esplicita', () => {
		// È l'invariante che tiene in piedi il resto. Da quando il valore predefinito è
		// "non scrivibile", dimenticare un'entità nuova la blocca in silenzio; prima la
		// stessa dimenticanza la lasciava aperta a tutto lo staff. In entrambi i casi
		// nessuno se ne accorge finché non è tardi, quindi la scelta va resa esplicita —
		// e questo test rifiuta di lasciarla implicita.
		const dimenticate = ENTITY_NAMES.filter((entita) => !haRegolaDiScrittura(entita));
		assert.deepEqual(
			dimenticate,
			[],
			`Entità senza regola di scrittura: decidi in authorize.js chi le scrive — ${dimenticate.join(', ')}`,
		);
	});
});

describe("l'istruttore non modifica quello che può solo vedere", () => {
	// La matrice predefinita gli dà crm_members:["view"] e crm_documents:["view"].
	for (const entita of ['Member', 'Subscription', 'Plan', 'MemberDocument', 'QRAccesso']) {
		test(`${entita} non è scrivibile da un istruttore`, () => {
			assert.equal(canWriteEntity('istruttore', entita), false);
		});
	}

	test('ma il calendario sì: le lezioni sono il suo lavoro', () => {
		assert.equal(canWriteEntity('istruttore', 'Session'), true);
		assert.equal(canWriteEntity('istruttore', 'Event'), true);
	});
});

describe('la reception fa il suo e non di più', () => {
	test('gestisce soci, documenti e calendario', () => {
		for (const entita of ['Member', 'MemberDocument', 'Booking', 'Session']) {
			assert.equal(canWriteEntity('reception', entita), true, `${entita} dovrebbe essere suo`);
		}
	});

	test('non tocca gli account', () => {
		assert.equal(canWriteEntity('reception', 'StaffAccount'), false);
	});
});

describe('il registro delle azioni si allunga e non si accorcia', () => {
	test('nessuno lo scrive dall’API: lo scrive il server', () => {
		// Le righe le creava il browser, con attore e orario decisi dal client.
		assert.equal(canWriteEntity('admin', 'AuditLog', 'POST'), false);
	});

	test('nemmeno un amministratore può cancellarle o riscriverle', () => {
		// Un registro che chi ci è dentro può ripulire non è un registro.
		assert.equal(canWriteEntity('admin', 'AuditLog', 'DELETE'), false);
		assert.equal(canWriteEntity('admin', 'AuditLog', 'PUT'), false);
	});
});

describe("l'intestazione dell'ente si modifica da dove si amministra", () => {
	test("l'amministratore può scriverla", () => {
		// Era mappata su un modulo che non esiste più, quindi non la poteva scrivere
		// nessuno: la prima schermata che avesse provato a cambiare nome o logo avrebbe
		// preso un 403 che nessun permesso poteva togliere.
		assert.equal(canWriteEntity('admin', 'Organization'), true);
	});

	test('un istruttore no', () => {
		assert.equal(canWriteEntity('istruttore', 'Organization'), false);
	});
});
