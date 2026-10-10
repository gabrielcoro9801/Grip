// Le comunicazioni automatiche: quando parte un playbook, su quale canale, e quando no.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	occasione, scegliCanale, inSilenzio, smsResidui, impostazioniComunicazioni, statoCanale, improntaCanale,
	listaDiControllo, riempi, segnapostoSconosciuti, testoPer, chiaveMessaggio, mittenteSmsValido, PLAYBOOK,
} from './comunicazioni.js';
import { segnaliPersona } from './segnali.js';
import { spostaGiorni } from './giorni.js';

const OGGI = '2026-10-10';
const g = (n) => spostaGiorni(OGGI, n);
const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
const regolare = { ultimo: g(-2), quattro: 8, dodici: 24, totale: 120 };
const certificatoBuono = [{ id: 'c1', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: '2027-06-01' }];
// Una persona come la passa il server: i segnali dal motore, più nome e scadenza.
const persona = (extra = {}) => {
	const r = segnaliPersona({ socio, documenti: certificatoBuono, ingressi: regolare, oggi: OGGI, ...extra });
	return { segnali: r.segnali, nome_proprio: 'Giulia', scadenza: r.copertura?.scadenza, abbonamento: r.copertura?.riferimento?.plan_name };
};
const abbonamentoFino = (fine) => [{ id: 'a1', plan_name: 'Trimestrale', start_date: '2026-07-01', end_date: fine }];

describe('le occasioni dei playbook', () => {
	test('rinnovo: a 14 e a 3 giorni dalla scadenza, una chiave per soglia', () => {
		const a14 = occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(14)) }), OGGI);
		assert.equal(a14.riferimento, 'a1:14');
		assert.equal(a14.valori.quando, 'scade tra 14 giorni');
		assert.deepEqual(a14.canali, ['app', 'email']);
		// Il giorno dopo è la stessa occasione: stessa chiave, non riparte.
		assert.equal(occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(13)) }), OGGI).riferimento, 'a1:14');
		assert.equal(occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(3)) }), OGGI).riferimento, 'a1:3');
		assert.equal(occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(30)) }), OGGI), null);
	});

	test('rinnovo: 3 giorni dopo la scadenza, e lì anche l\'SMS', () => {
		const dopo = occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(-3)) }), OGGI);
		assert.equal(dopo.riferimento, 'a1:-3');
		assert.deepEqual(dopo.canali, ['app', 'email', 'sms']);
		assert.equal(dopo.valori.quando, 'è scaduto da 3 giorni');
		// Il giorno dopo la scadenza è presto, dopo dieci giorni è tardi.
		assert.equal(occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(-1)) }), OGGI), null);
		assert.equal(occasione('rinnovo', persona({ iscrizioni: abbonamentoFino(g(-20)) }), OGGI), null);
	});

	test('rinnovo: non a chi l\'ha già chiesto dal portale', () => {
		const p = persona({ iscrizioni: abbonamentoFino(g(3)), contatti: { richiestaRinnovo: `${g(-1)}T10:00:00Z` } });
		assert.equal(occasione('rinnovo', p, OGGI), null);
	});

	test('un contatto dello staff tace il messaggio automatico', () => {
		const p = persona({ iscrizioni: abbonamentoFino(g(3)), contatti: { ultimo: g(-1) } });
		assert.equal(occasione('rinnovo', p, OGGI), null);
	});

	test('assenza: dal 21° giorno, una volta per assenza', () => {
		const iscrizioni = abbonamentoFino('2027-01-01');
		assert.equal(occasione('assenza', persona({ iscrizioni, ingressi: { ...regolare, ultimo: g(-15) } }), OGGI), null);
		const a = occasione('assenza', persona({ iscrizioni, ingressi: { ...regolare, ultimo: g(-21) } }), OGGI);
		assert.equal(a.riferimento, `dal:${g(-21)}`);
		// Il giorno dopo, la stessa assenza ha la stessa chiave.
		const dopo = occasione('assenza', persona({ iscrizioni, ingressi: { ...regolare, ultimo: g(-22) } }), g(0));
		assert.equal(dopo.riferimento, `dal:${g(-22)}`);
	});

	test('ambientamento: la prima settimana, legato al giorno d\'iscrizione', () => {
		const nuovo = { ...socio, created_date: g(-8) };
		const r = segnaliPersona({ socio: nuovo, iscrizioni: [{ id: 'n', plan_name: 'Mensile', start_date: g(-8), end_date: g(22) }], ingressi: regolare, oggi: OGGI });
		const o = occasione('ambientamento', { segnali: r.segnali }, OGGI);
		assert.equal(o.riferimento, `iscritto:${g(-8)}`);
	});

	test('certificato: 30 e 7 giorni prima, e scaduto', () => {
		const iscrizioni = abbonamentoFino('2027-01-01');
		const doc = (scade) => [{ id: 'c9', document_type: 'certificato_medico', created_date: '2025-10-01', expiry_date: scade }];
		assert.equal(occasione('certificato', persona({ iscrizioni, documenti: doc(g(25)) }), OGGI).riferimento, 'c9:30');
		assert.equal(occasione('certificato', persona({ iscrizioni, documenti: doc(g(5)) }), OGGI).riferimento, 'c9:7');
		const scaduto = occasione('certificato', persona({ iscrizioni, documenti: doc(g(-2)) }), OGGI);
		assert.equal(scaduto.riferimento, 'c9:scaduto');
		assert.equal(scaduto.valori.quando, 'è scaduto');
	});

	test('compleanno: una volta all\'anno', () => {
		const p = persona({ socio: { ...socio, date_of_birth: '1990-10-10' }, iscrizioni: abbonamentoFino('2027-01-01') });
		assert.equal(occasione('compleanno', p, OGGI).riferimento, 'anno:2026');
	});

	test('gli immediati non vengono dal giro', () => {
		assert.equal(occasione('lezione_annullata', persona({ iscrizioni: abbonamentoFino(g(3)) }), OGGI), null);
	});
});

describe('la scelta del canale', () => {
	const base = { canali: ['app', 'email', 'sms'], pronti: ['app', 'email', 'sms'], recapiti: { app: true, email: 'g@x.it', sms: '+39333' }, smsResidui: 10 };

	test('il primo canale pronto, nell\'ordine portale → email → SMS', () => {
		assert.deepEqual(scegliCanale(base), { canale: 'app', stato: 'ok' });
		assert.equal(scegliCanale({ ...base, recapiti: { email: 'g@x.it', sms: '+39333' } }).canale, 'email');
		assert.equal(scegliCanale({ ...base, pronti: ['sms'] }).canale, 'sms');
	});

	test('nessun canale possibile: niente da scrivere', () => {
		assert.equal(scegliCanale({ ...base, pronti: [] }), null);
		assert.equal(scegliCanale({ ...base, recapiti: {} }), null);
	});

	test('il marketing chiede il consenso del canale; il servizio no', () => {
		const solo = { ...base, canali: ['email'], recapiti: { email: 'g@x.it' } };
		assert.equal(scegliCanale({ ...solo, tipo: 'marketing' }).stato, 'bloccato_consenso');
		assert.equal(scegliCanale({ ...solo, tipo: 'marketing', consensi: { marketing_email: { valore: true } } }).stato, 'ok');
		assert.equal(scegliCanale({ ...solo, tipo: 'servizio' }).stato, 'ok');
		// Senza consenso sull'email ma con quello sugli SMS, si passa all'SMS.
		const due = { ...base, canali: ['email', 'sms'], tipo: 'marketing', consensi: { marketing_sms: { valore: true } } };
		assert.equal(scegliCanale(due).canale, 'sms');
	});

	test('budget SMS esaurito: bloccato, mai sforato', () => {
		const sms = { ...base, canali: ['sms'], smsResidui: 0 };
		assert.equal(scegliCanale(sms).stato, 'bloccato_budget');
	});

	test('un minore riceve solo nel portale', () => {
		assert.equal(scegliCanale({ ...base, minorenne: true }).canale, 'app');
		const r = scegliCanale({ ...base, minorenne: true, canali: ['email', 'sms'] });
		assert.equal(r.stato, 'bloccato_consenso');
		assert.match(r.motivo, /minorenne/);
	});
});

describe('silenzio e budget', () => {
	// 21:30 e 08:30 a Roma (ora legale, UTC+2).
	test('la fascia 21–9 passa la mezzanotte', () => {
		assert.equal(inSilenzio(new Date('2026-10-10T19:30:00Z')), true);
		assert.equal(inSilenzio(new Date('2026-10-10T06:30:00Z')), true);
		assert.equal(inSilenzio(new Date('2026-10-10T07:30:00Z')), false);
		assert.equal(inSilenzio(new Date('2026-10-10T12:00:00Z'), { dalle: 13, alle: 15 }), true);
		assert.equal(inSilenzio(new Date('2026-10-10T12:00:00Z'), { dalle: 9, alle: 9 }), false);
	});

	test('il budget è un tetto: quanti SMS restano', () => {
		assert.equal(smsResidui({ budgetCentesimi: 1000, spesiCentesimi: 970, costoCentesimi: 6 }), 5);
		assert.equal(smsResidui({ budgetCentesimi: 1000, spesiCentesimi: 1000, costoCentesimi: 6 }), 0);
		assert.equal(smsResidui({ budgetCentesimi: 0, costoCentesimi: 6 }), 0);
	});
});

describe('impostazioni e canali', () => {
	test('di partenza è tutto spento', () => {
		const i = impostazioniComunicazioni(undefined);
		assert.equal(i.attive, false);
		assert.equal(i.budget_sms_centesimi, 0);
		assert.ok(PLAYBOOK.every((p) => i.playbook[p.codice] === 'spento'));
		assert.deepEqual(i.silenzio, { dalle: 21, alle: 9 });
		// Un valore salvato male non accende niente.
		assert.equal(impostazioniComunicazioni({ attive: 'si', playbook: { rinnovo: 'acceso' } }).playbook.rinnovo, 'spento');
	});

	test('un canale: non configurato → da verificare → pronto', () => {
		const conf = { fornitore: 'brevo', mittente: 'info@palestra.it', nome_mittente: 'Palestra' };
		assert.equal(statoCanale('email', {}), 'non_configurato');
		assert.equal(statoCanale('email', conf), 'non_configurato'); // manca la chiave
		const segreto = { impostato: true, aggiornato: '2026-10-10T10:00:00Z' };
		assert.equal(statoCanale('email', conf, { segreto }), 'da_verificare');
		const verificato = { ...conf, verificato: { impronta: improntaCanale(conf, segreto.aggiornato), reale: false } };
		assert.equal(statoCanale('email', verificato, { segreto }), 'pronto');
		// Verificato in simulazione: con gli invii veri accesi torna da verificare.
		assert.equal(statoCanale('email', verificato, { segreto, inviiReali: true }), 'da_verificare');
		// Cambiato il mittente, la verifica non vale più.
		assert.equal(statoCanale('email', { ...verificato, mittente: 'altro@palestra.it' }, { segreto }), 'da_verificare');
		assert.equal(statoCanale('app', { attivo: true }), 'pronto');
	});

	test('la lista di controllo apre l\'interruttore solo se è completa', () => {
		assert.equal(listaDiControllo({ statiCanali: { app: 'pronto' }, informativa: { il: 'x' } }).completa, false);
		assert.equal(listaDiControllo({ statiCanali: { email: 'da_verificare' }, informativa: {}, testiRivisti: {} }).completa, false);
		assert.equal(listaDiControllo({ statiCanali: { email: 'pronto' }, informativa: {}, testiRivisti: {} }).completa, true);
		// Senza l'indirizzo pubblico i link non funzionerebbero: resta chiusa.
		assert.equal(listaDiControllo({ statiCanali: { email: 'pronto' }, informativa: {}, testiRivisti: {}, indirizzoPubblico: false }).completa, false);
	});
});

describe('testi', () => {
	test('segnaposto riempiti, e quelli sbagliati riconosciuti', () => {
		assert.equal(riempi('Ciao {nome}, {quando}.', { nome: 'Giulia', quando: 'scade domani' }), 'Ciao Giulia, scade domani.');
		assert.equal(riempi('Ciao {nome}{vuoto}!', { nome: 'Giulia' }), 'Ciao Giulia!');
		assert.deepEqual(segnapostoSconosciuti('Ciao {nome} {nomee}'), ['nomee']);
	});

	test('il testo della palestra prevale sul predefinito', () => {
		assert.equal(testoPer('rinnovo', 'email').personalizzato, false);
		assert.equal(testoPer('rinnovo', 'sms').oggetto, '');
		const suo = testoPer('rinnovo', 'email', [{ playbook: 'rinnovo', canale: 'email', oggetto: 'X', testo: 'Y' }]);
		assert.deepEqual(suo, { oggetto: 'X', testo: 'Y', personalizzato: true });
	});

	test('chiave: l\'anteprima non occupa il posto dell\'invio vero', () => {
		const k = { palestra: 'p', playbook: 'rinnovo', persona: 'x', riferimento: 'a1:3' };
		assert.notEqual(chiaveMessaggio(k), chiaveMessaggio({ ...k, simulato: true }));
	});

	test('mittente SMS: fino a 11 caratteri, con almeno una lettera', () => {
		assert.equal(mittenteSmsValido('Palestra'), true);
		assert.equal(mittenteSmsValido('PalestraGrip1'), false);
		assert.equal(mittenteSmsValido('12345'), false);
	});
});
