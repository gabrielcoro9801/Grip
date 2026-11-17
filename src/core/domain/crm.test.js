// Le regole di fondo del CRM: telefono, soglie della palestra, consensi, diario.
//
// Girano con `node --test`, senza Vite.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizzaTelefono, linkWhatsApp } from './anagrafica.js';
import { SOGLIE, soglieDi } from './soglie.js';
import { consensiAttuali } from './consensi.js';
import { descriviAttivita } from './diario.js';

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
		const s = soglieDi({ soglie: { abbonamentoInScadenzaGiorni: 7, segnali: { nuovoGiorni: 20, assenzaGiorni: -1, caloPercentuale: 'tanti' } } });
		assert.equal(s.abbonamentoInScadenzaGiorni, 7);
		assert.equal(s.segnali.nuovoGiorni, 20);
		assert.equal(s.segnali.assenzaGiorni, SOGLIE.segnali.assenzaGiorni, 'un numero negativo si ignora');
		assert.equal(s.segnali.caloPercentuale, SOGLIE.segnali.caloPercentuale, 'un testo si ignora');
		assert.equal(s.scadutoGiorni, SOGLIE.scadutoGiorni);
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

	test("dalla reception non vale più: il modulo firmato che lo provava non c'è", () => {
		const senza = consensiAttuali([{ tipo: 'marketing_email', valore: true, fonte: 'reception', created_date: '2026-09-01T10:00:00Z' }]).marketing_email;
		assert.equal(senza.valore, false);
		assert.equal(senza.senza_prova, true);
	});

	test("l'ultima scelta si trova anche con le date del database (Date, non testo)", () => {
		const attuali = consensiAttuali([
			{ tipo: 'marketing_sms', valore: true, fonte: 'portale', created_date: new Date('2026-09-05T10:00:00Z') },
			{ tipo: 'marketing_sms', valore: false, fonte: 'portale', created_date: new Date('2026-09-07T10:00:00Z') }, // lunedì: come testo verrebbe prima di sabato
		]);
		assert.equal(attuali.marketing_sms.valore, false);
	});
});

describe('il diario', () => {
	test("l'iscrizione e le righe di quando c'erano i lead", () => {
		assert.equal(descriviAttivita({ tipo: 'iscrizione', esito: 'nuovo' }), 'Diventato socio');
		assert.equal(descriviAttivita({ tipo: 'iscrizione', esito: 'riattivato' }), 'Tornato socio');
		assert.equal(descriviAttivita({ tipo: 'richiamo', esito: '2026-10-12' }), 'Da richiamare il 12/10/2026');
		assert.equal(descriviAttivita({ tipo: 'stato_automatico', esito: 'non_raggiungibile' }), 'Passato a «Non raggiungibile»');
		assert.equal(descriviAttivita({ tipo: 'chiusura', esito: 'prezzo' }), 'Non interessato: Prezzo');
	});

	test('un "Fatto" di Da fare non dice il mezzo, con o senza canale', () => {
		assert.equal(descriviAttivita({ tipo: 'contatto', esito: 'fatto' }), 'Fatto');
		assert.equal(descriviAttivita({ tipo: 'contatto', esito: 'fatto', canale: 'telefono' }), 'Fatto');
	});
});
