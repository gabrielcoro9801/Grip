// Le regole di fondo del CRM: telefono, soglie della palestra, consensi, contatto minimo.
//
// Girano con `node --test`, senza Vite.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizzaTelefono, linkWhatsApp } from './anagrafica.js';
import { SOGLIE, soglieDi } from './soglie.js';
import { consensiAttuali } from './consensi.js';
import { motivoLeadIncompleto, applicaAzione, descriviAttivita, filtraAndamento } from './lead.js';

describe('il telefono', () => {
	test('in formato internazionale, comunque sia scritto', () => {
		for (const [scritto, atteso] of [
			['333 123 4567', '+393331234567'],
			['333.1234567', '+393331234567'],
			['(333) 123-4567', '+393331234567'],
			['+39 333 1234567', '+393331234567'],
			['0039 333 1234567', '+393331234567'],
			['393331234567', '+393331234567'],
			['3912345678', '+393912345678'], // un cellulare che comincia per 39
			['06 1234567', '+39061234567'],
			['+44 20 7946 0958', '+442079460958'],
		]) assert.equal(normalizzaTelefono(scritto), atteso, scritto);
	});

	test('quello che non è un numero è null', () => {
		for (const scritto of ['', '   ', null, undefined, '333 000', 'chiamare', '+39 333 12+34567', '12345', '+0123456789']) {
			assert.equal(normalizzaTelefono(scritto), null, String(scritto));
		}
	});

	test('il link di WhatsApp ha solo le cifre, e il testo codificato', () => {
		assert.equal(linkWhatsApp('333 1234567'), 'https://wa.me/393331234567');
		assert.equal(linkWhatsApp('333 1234567', 'Ciao Anna!'), 'https://wa.me/393331234567?text=Ciao%20Anna!');
		assert.equal(linkWhatsApp('non è un numero'), null);
	});
});

describe('le soglie della palestra', () => {
	test('senza impostazioni valgono le predefinite', () => {
		assert.deepEqual(soglieDi(undefined), { ...SOGLIE, segnaliSpenti: [] });
		assert.deepEqual(soglieDi({}), { ...SOGLIE, segnaliSpenti: [] });
	});

	test('le sue dove sono giorni sensati, le predefinite per il resto', () => {
		const s = soglieDi({ soglie: { abbonamentoInScadenzaGiorni: 7, lead: { sollecitoGiorni: 2, fermaGiorni: -1, recuperoGiorni: 'tanti' } } });
		assert.equal(s.abbonamentoInScadenzaGiorni, 7);
		assert.equal(s.lead.sollecitoGiorni, 2);
		assert.equal(s.lead.fermaGiorni, SOGLIE.lead.fermaGiorni, 'un numero negativo si ignora');
		assert.equal(s.lead.recuperoGiorni, SOGLIE.lead.recuperoGiorni, 'un testo si ignora');
		assert.equal(s.documentoInScadenzaGiorni, SOGLIE.documentoInScadenzaGiorni);
	});
});

describe('i consensi', () => {
	test("vale l'ultima scelta per tipo; senza scelte il consenso non c'è", () => {
		const attuali = consensiAttuali([
			{ tipo: 'marketing_email', valore: true, fonte: 'reception', created_date: '2026-09-01T10:00:00Z' },
			{ tipo: 'marketing_email', valore: false, fonte: 'portale', created_date: '2026-09-05T10:00:00Z' },
			{ tipo: 'marketing_sms', valore: true, fonte: 'portale', created_date: '2026-09-02T10:00:00Z' },
		]);
		assert.deepEqual(attuali.marketing_email, { valore: false, fonte: 'portale', il: '2026-09-05T10:00:00Z', senza_prova: false });
		assert.equal(attuali.marketing_sms.valore, true);
		assert.deepEqual(attuali.marketing_push, { valore: false, fonte: null, il: null, senza_prova: false });
	});

	test('dalla reception vale solo con il modulo firmato, e decade se il modulo sparisce', () => {
		const riga = (extra) => ({ tipo: 'marketing_email', valore: true, fonte: 'reception', created_date: '2026-09-01T10:00:00Z', ...extra });
		assert.equal(consensiAttuali([riga({ documento_id: 'd1', documento_presente: true })]).marketing_email.valore, true);
		const senza = consensiAttuali([riga({ documento_id: 'd1', documento_presente: false })]).marketing_email;
		assert.equal(senza.valore, false);
		assert.equal(senza.senza_prova, true);
		assert.equal(consensiAttuali([riga({})]).marketing_email.valore, false, 'senza modulo non vale');
	});

	test("l'ultima scelta si trova anche con le date del database (Date, non testo)", () => {
		const attuali = consensiAttuali([
			{ tipo: 'marketing_sms', valore: true, fonte: 'portale', created_date: new Date('2026-09-05T10:00:00Z') },
			{ tipo: 'marketing_sms', valore: false, fonte: 'portale', created_date: new Date('2026-09-07T10:00:00Z') }, // lunedì: come testo verrebbe prima di sabato
		]);
		assert.equal(attuali.marketing_sms.valore, false);
	});
});

describe('il contatto minimo', () => {
	const minimo = { nome: 'Anna', telefono: '333 1234567', canale_id: 'c', data_contatto: '2026-09-10' };
	test('nome, un recapito, canale e giorno bastano', () => {
		assert.equal(motivoLeadIncompleto(minimo), null);
		assert.equal(motivoLeadIncompleto({ ...minimo, telefono: '', email: 'a@b.it' }), null);
	});
	test('e ognuno di loro serve', () => {
		assert.match(motivoLeadIncompleto({ ...minimo, nome: ' ' }), /nome/);
		assert.match(motivoLeadIncompleto({ ...minimo, telefono: '' }), /recapito/);
		assert.match(motivoLeadIncompleto({ ...minimo, telefono: '333' }), /telefono non è valido/);
		assert.match(motivoLeadIncompleto({ ...minimo, canale_id: '' }), /canale/);
		assert.match(motivoLeadIncompleto({ ...minimo, data_contatto: '' }), /giorno/);
	});
});

describe('la trattativa iscritta', () => {
	test('non si lavora più, nemmeno per riaprirla', () => {
		for (const azione of [{ tipo: 'riapri' }, { tipo: 'contatto', canale: 'telefono', esito: 'risposto' }]) {
			assert.match(applicaAzione({ stato: 'iscritto' }, azione, '2026-10-10').errore, /diventato socio/);
		}
	});
	test('nel diario si legge come iscrizione', () => {
		assert.equal(descriviAttivita({ tipo: 'iscrizione', esito: 'nuovo' }), 'Diventato socio');
		assert.equal(descriviAttivita({ tipo: 'iscrizione', esito: 'riattivato' }), 'Tornato socio');
		assert.equal(descriviAttivita({ tipo: 'richiamo', esito: '2026-10-12' }), 'Da richiamare il 12/10/2026');
	});
});

describe('Andamento, il sesso non indicato', () => {
	test('si filtra come "nd"', () => {
		const righe = [{ data_contatto: '2026-09-01', sesso: null }, { data_contatto: '2026-09-02', sesso: 'F' }];
		assert.equal(filtraAndamento(righe, { sesso: 'nd' }).length, 1);
		assert.equal(filtraAndamento(righe, { sesso: 'F' }).length, 1);
	});
});
