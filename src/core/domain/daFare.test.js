// Gli avvisi di Da fare: quali si aprono, con che chiave, come si chiudono e in che ordine.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	TIPI_AVVISO, ESITI, avvisiDi, esitoChiusura, ordina, esitoAManoValido, etichettaEsito, quando, testoAvviso,
} from './daFare.js';
import { SEGNALI } from './segnali.js';
import { spostaGiorni } from './giorni.js';
import { soglieDi, SOGLIE } from './soglie.js';

const OGGI = '2026-10-10';
const g = (n) => spostaGiorni(OGGI, n);
const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
const annuale = { id: 'a1', plan_name: 'Annuale', start_date: '2026-01-01', end_date: '2026-12-31' };
const regolare = { ultimo: g(-2), quattro: 8, dodici: 24, totale: 120 };
const certificato = { id: 'c1', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: '2027-06-01' };
const identita = { id: 'i1', document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: '2030-01-01' };
const persona = (extra = {}) => ({ socio, iscrizioni: [annuale], documenti: [certificato, identita], ingressi: regolare, ...extra });
const di = (extra = {}, oggi = OGGI, soglie = SOGLIE) => avvisiDi(persona(extra), oggi, soglie);
// Abbonamento lungo e niente ingressi registrati: le date dei compleanni vanno fino al 2028.
const nato = (data) => ({ socio: { ...socio, date_of_birth: data }, iscrizioni: [{ ...annuale, end_date: '2030-12-31' }], ingressi: null });

describe('i tipi', () => {
	test('cinque avvisi, e ogni segnale per lo staff ne apre uno', () => {
		assert.deepEqual(TIPI_AVVISO.map((t) => t.valore), ['in_scadenza', 'scaduto', 'frequenza', 'documento', 'compleanno']);
		const coperti = TIPI_AVVISO.flatMap((t) => t.segnali);
		for (const s of SEGNALI) assert.ok(coperti.includes(s.valore), s.valore);
	});

	test('Contattato solo per la frequenza, Auguri fatti solo per i compleanni, Nascosto per tutti', () => {
		assert.ok(esitoAManoValido('contattato', 'frequenza'));
		assert.ok(!esitoAManoValido('contattato', 'compleanno'));
		assert.ok(esitoAManoValido('auguri_fatti', 'compleanno'));
		assert.ok(!esitoAManoValido('auguri_fatti', 'scaduto'));
		for (const t of TIPI_AVVISO) assert.ok(esitoAManoValido('nascosto', t.valore));
		assert.ok(!esitoAManoValido('rinnovato', 'in_scadenza'), 'le chiusure automatiche non si scelgono');
		assert.deepEqual(ESITI.filter((e) => e.aMano).map((e) => e.valore), ['nascosto', 'contattato', 'auguri_fatti']);
		assert.ok(ESITI.every((e) => e.valore.length <= 24), 'esito sta in varchar(24)');
	});

	test('le parole: quando, la frase, l\'esito con le soglie', () => {
		assert.equal(quando(OGGI, OGGI), 'oggi');
		assert.equal(quando(g(1), OGGI), 'domani');
		assert.equal(quando(g(4), OGGI), 'tra 4 giorni');
		assert.equal(quando(g(-1), OGGI), '1 giorno fa');
		assert.equal(quando(g(-10), OGGI), '10 giorni fa');
		assert.equal(etichettaEsito('chiuso_dopo_giorni', 'scaduto'), 'Chiuso dopo 60 giorni');
		assert.equal(etichettaEsito('chiuso_dopo_giorni', 'compleanno', soglieDi({ soglie: { compleannoDopoGiorni: 0 } })), 'Chiuso il giorno stesso');
		assert.equal(etichettaEsito('passato_in_scaduti', 'in_scadenza'), 'Passato in Scaduti');
	});
});

describe('quali avvisi si aprono', () => {
	test('un socio in regola non ha avvisi; un contatto nemmeno', () => {
		assert.deepEqual(di(), []);
		assert.deepEqual(avvisiDi({ socio: null }, OGGI), []);
	});

	test('in scadenza e scaduto hanno la stessa chiave: l\'id dell\'abbonamento', () => {
		const mensile = { id: 'm1', plan_name: 'Mensile', start_date: '2025-01-01', end_date: g(4) };
		const [prima] = di({ iscrizioni: [mensile] });
		assert.deepEqual(prima, { tipo: 'in_scadenza', chiave: 'm1', dati: { data: g(4), abbonamento: 'Mensile', iscrizione_id: 'm1', frase: 'Abbonamento in scadenza il 14/10/2026' } });
		assert.equal(testoAvviso(prima, OGGI), 'Abbonamento in scadenza il 14/10/2026 · tra 4 giorni');
		const [dopo] = di({ iscrizioni: [mensile] }, g(5));
		assert.equal(dopo.tipo, 'scaduto');
		assert.equal(dopo.chiave, 'm1');
		assert.equal(testoAvviso(dopo, g(5)), 'Abbonamento scaduto il 14/10/2026 · 1 giorno fa');
	});

	test('lo scaduto esce dopo scadutoGiorni', () => {
		const finito = { id: 'm1', start_date: '2025-01-01', end_date: g(-60) };
		assert.equal(di({ iscrizioni: [finito] })[0]?.tipo, 'scaduto');
		assert.deepEqual(di({ iscrizioni: [{ ...finito, end_date: g(-61) }] }), []);
		assert.deepEqual(di({ iscrizioni: [{ ...finito, end_date: g(-31) }] }, OGGI, soglieDi({ soglie: { scadutoGiorni: 30 } })), []);
	});

	test('la frequenza: assente o in calo, con la media e gli ingressi delle 4 settimane', () => {
		const [calo] = di({ ingressi: { ...regolare, quattro: 2, dodici: 25 } });
		assert.equal(calo.tipo, 'frequenza');
		assert.equal(calo.chiave, OGGI);
		assert.equal(calo.dati.frase, 'Frequenza media ogni 4 settimane: 8,3 · Entrate nelle ultime 4 settimane: 2');
		assert.equal(testoAvviso(calo, OGGI), calo.dati.frase);
		const [assente] = di({ ingressi: { ...regolare, ultimo: g(-20), quattro: 0 } });
		assert.equal(assente.tipo, 'frequenza');
		assert.equal(assente.dati.segnale, 'assente');
	});

	test('un avviso per documento, con l\'id del documento come chiave', () => {
		const avvisi = di({ documenti: [
			{ ...certificato, id: 'c9', file_name: 'c.pdf', expiry_date: g(-10) },
			{ ...identita, id: 'i9', expiry_date: g(12) },
		] });
		assert.deepEqual(avvisi.map((a) => [a.tipo, a.chiave]), [['documento', 'c9'], ['documento', 'i9']]);
		assert.equal(testoAvviso(avvisi[0], OGGI), 'Certificato medico scaduto il 30/09/2026 · 10 giorni fa');
		assert.equal(avvisi[1].dati.tipo_documento, 'documento_identita');
		assert.match(testoAvviso(avvisi[1], OGGI), /in scadenza il 22\/10\/2026 · tra 12 giorni$/);
		// Quello che manca non apre niente.
		assert.deepEqual(di({ documenti: [certificato] }), []);
	});

	test('il compleanno: da 3 giorni prima a 3 dopo, con l\'anno come chiave', () => {
		const [c] = di(nato('1990-10-13'));
		assert.deepEqual(c, { tipo: 'compleanno', chiave: '2026', dati: { data: '2026-10-13', frase: 'Compleanno il 13/10' } });
		assert.equal(testoAvviso(c, OGGI), 'Compleanno il 13/10 · tra 3 giorni');
		assert.equal(di(nato('1990-10-07'))[0]?.tipo, 'compleanno');
		assert.deepEqual(di(nato('1990-10-14')), []);
		assert.deepEqual(di(nato('1990-10-06')), []);
	});

	test('il compleanno a cavallo d\'anno prende l\'anno giusto', () => {
		assert.deepEqual(di(nato('1990-12-31'), '2027-01-02').map((a) => [a.chiave, a.dati.data]), [['2026', '2026-12-31']]);
		assert.deepEqual(di(nato('1990-01-01'), '2026-12-29').map((a) => [a.chiave, a.dati.data]), [['2027', '2027-01-01']]);
		assert.deepEqual(di(nato('1990-12-31'), '2027-01-04'), []);
	});

	test('il 29 febbraio, negli anni normali, è il 28', () => {
		const [c] = di(nato('2000-02-29'), '2027-02-25');
		assert.equal(c.dati.data, '2027-02-28');
		assert.deepEqual(di(nato('2000-02-29'), '2028-02-26').filter((a) => a.tipo === 'compleanno').map((a) => a.dati.data), ['2028-02-29']);
	});

	test('con 0 prima e 0 dopo, solo il giorno stesso', () => {
		const zero = soglieDi({ soglie: { compleannoPrimaGiorni: 0, compleannoDopoGiorni: 0 } });
		assert.equal(zero.compleannoPrimaGiorni, 0, 'lo zero è ammesso');
		assert.equal(di(nato('1990-10-10'), OGGI, zero).length, 1);
		assert.deepEqual(di(nato('1990-10-11'), OGGI, zero), []);
		assert.deepEqual(di(nato('1990-10-09'), OGGI, zero), []);
	});

	test('un segnale spento non apre avvisi; un socio archiviato nemmeno', () => {
		assert.deepEqual(di(nato('1990-10-10'), OGGI, soglieDi({ segnali_spenti: ['compleanno'] })), []);
		assert.deepEqual(di({ socio: { ...socio, archiviato_il: g(-1), date_of_birth: '1990-10-10' } }), []);
	});

	test('accetta anche i segnali già calcolati dal server', () => {
		const segnali = [{ codice: 'compleanno', pubblico: 'staff', priorita: 10, nascostoFino: null, dati: { data: '2026-10-11', anno: 2026, giorni: 1 } }];
		assert.deepEqual(avvisiDi({ segnali }, OGGI).map((a) => a.chiave), ['2026']);
	});
});

describe('come si chiudono da soli', () => {
	const inScadenza = { tipo: 'in_scadenza', chiave: 'm1', dati: { data: g(4) } };
	const scaduto = { tipo: 'scaduto', chiave: 'm1', dati: { data: g(-10) } };
	const mensile = { id: 'm1', start_date: '2026-09-15', end_date: g(4) };

	test('socio archiviato, per ogni tipo', () => {
		for (const t of TIPI_AVVISO) {
			assert.equal(esitoChiusura({ tipo: t.valore, chiave: 'x', dati: {} }, { archiviato_il: OGGI }, OGGI), 'socio_archiviato');
		}
	});

	test('rinnovato: un altro abbonamento copre oltre la fine', () => {
		const rinnovo = { id: 'm2', start_date: g(5), end_date: g(35) };
		assert.equal(esitoChiusura(inScadenza, { iscrizioni: [mensile, rinnovo] }, OGGI), 'rinnovato');
		assert.equal(esitoChiusura(scaduto, { iscrizioni: [mensile, { id: 'm2', start_date: OGGI, end_date: g(30) }] }, OGGI), 'rinnovato');
	});

	test('l\'in scadenza che scade passa in Scaduti', () => {
		assert.equal(esitoChiusura(inScadenza, { iscrizioni: [mensile] }, g(5)), 'passato_in_scaduti');
	});

	test('lo scaduto si chiude dopo scadutoGiorni', () => {
		assert.equal(esitoChiusura(scaduto, { iscrizioni: [] }, g(51)), 'chiuso_dopo_giorni');
		assert.equal(esitoChiusura(scaduto, { iscrizioni: [] }, g(50)), 'non_piu_da_fare');
	});

	test('documento caricato: uno nuovo dello stesso tipo', () => {
		const vecchio = { id: 'c1', document_type: 'certificato_medico', created_date: '2025-10-01' };
		const avviso = { tipo: 'documento', chiave: 'c1', dati: { tipo_documento: 'certificato_medico' } };
		assert.equal(esitoChiusura(avviso, { documenti: [vecchio, { id: 'c2', document_type: 'certificato_medico', created_date: '2026-10-09' }] }, OGGI), 'documento_caricato');
		assert.equal(esitoChiusura(avviso, { documenti: [vecchio, { id: 'i2', document_type: 'documento_identita', created_date: '2026-10-09' }] }, OGGI), 'non_piu_da_fare');
	});

	test('il compleanno si chiude dopo compleannoDopoGiorni', () => {
		const avviso = { tipo: 'compleanno', chiave: '2026', dati: { data: g(-4) } };
		assert.equal(esitoChiusura(avviso, {}, OGGI), 'chiuso_dopo_giorni');
		assert.equal(esitoChiusura({ ...avviso, dati: { data: g(-2) } }, {}, OGGI), 'non_piu_da_fare');
		assert.equal(esitoChiusura({ ...avviso, dati: { data: g(-1) } }, {}, OGGI, soglieDi({ soglie: { compleannoDopoGiorni: 0 } })), 'chiuso_dopo_giorni');
	});

	test('la frequenza che torna normale: non più da fare', () => {
		assert.equal(esitoChiusura({ tipo: 'frequenza', chiave: g(-5), dati: {} }, {}, OGGI), 'non_piu_da_fare');
	});
});

describe('l\'ordine di ogni scheda', () => {
	const avviso = (tipo, nome, dati) => ({ tipo, nome, dati });
	const nomi = (l) => l.map((a) => a.nome);

	test('in scadenza: la fine più vicina in alto', () => {
		assert.deepEqual(nomi(ordina([avviso('in_scadenza', 'B', { data: g(9) }), avviso('in_scadenza', 'A', { data: g(2) })], 'in_scadenza')), ['A', 'B']);
	});

	test('scaduti: il più recente in alto', () => {
		assert.deepEqual(nomi(ordina([avviso('scaduto', 'A', { data: g(-30) }), avviso('scaduto', 'B', { data: g(-1) })], 'scaduto')), ['B', 'A']);
	});

	test('frequenza: chi entra meno in alto; a parità, chi aveva la media più alta', () => {
		const l = [avviso('frequenza', 'A', { quattro: 3, media: 9 }), avviso('frequenza', 'B', { quattro: 0, media: 5 }), avviso('frequenza', 'C', { quattro: 3, media: 12 })];
		assert.deepEqual(nomi(ordina(l, 'frequenza')), ['B', 'C', 'A']);
	});

	test('documenti per data di scadenza, compleanni per data, a parità per nome', () => {
		assert.deepEqual(nomi(ordina([avviso('documento', 'B', { data: g(5) }), avviso('documento', 'A', { data: g(-5) })], 'documento')), ['A', 'B']);
		const l = [avviso('compleanno', 'Zeno', { data: g(1) }), avviso('compleanno', 'Anna', { data: g(1) }), avviso('compleanno', 'Bice', { data: g(-2) })];
		assert.deepEqual(nomi(ordina(l, 'compleanno')), ['Bice', 'Anna', 'Zeno']);
		assert.equal(l[0].nome, 'Zeno', 'non cambia l\'elenco che riceve');
	});
});
