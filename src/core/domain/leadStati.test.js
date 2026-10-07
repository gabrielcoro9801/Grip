// Gli stati dei lead: le azioni che li cambiano e le condizioni di tempo che ne fanno i filtri
// rapidi — domani, i trigger delle automazioni. Le soglie si provano ai confini.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	applicaAzione, condizioniLead, contaFiltriLead, daChiudereComeNonRaggiungibile, descriviTempoLead, SOGLIE_LEAD,
} from './lead.js';
import { spostaGiorni } from './giorni.js';

const OGGI = '2026-10-07';
const fa = (giorni) => spostaGiorni(OGGI, -giorni);
const nuovo = { stato: 'nuovo', tentativi_senza_risposta: 0, data_contatto: fa(2), stato_dal: fa(2) };

describe('le azioni', () => {
	test('un tentativo senza risposta: in attesa, e i tentativi si contano', () => {
		const primo = applicaAzione(nuovo, { tipo: 'contatto', canale: 'telefono', esito: 'nessuna_risposta' }, OGGI);
		assert.deepEqual(primo.campi, { stato: 'in_attesa', stato_dal: OGGI, tentativi_senza_risposta: 1, ultimo_contatto_il: OGGI, richiamare_il: null });
		assert.deepEqual(primo.attivita, { tipo: 'tentativo', canale: 'telefono', esito: 'nessuna_risposta' });

		const secondo = applicaAzione({ ...nuovo, ...primo.campi }, { tipo: 'contatto', canale: 'whatsapp', esito: 'nessuna_risposta' }, OGGI);
		assert.equal(secondo.campi.tentativi_senza_risposta, 2);
		assert.equal('stato' in secondo.campi, false, 'lo stato non cambia, e nemmeno la sua data');
	});

	test('una risposta apre la conversazione e azzera i tentativi', () => {
		const r = applicaAzione({ ...nuovo, stato: 'in_attesa', tentativi_senza_risposta: 2 }, { tipo: 'contatto', canale: 'telefono', esito: 'risposto' }, OGGI);
		assert.equal(r.campi.stato, 'in_conversazione');
		assert.equal(r.campi.tentativi_senza_risposta, 0);
		assert.equal(r.campi.ultima_risposta_il, OGGI);
	});

	test('serve il canale, e serve sapere se ha risposto', () => {
		assert.match(applicaAzione(nuovo, { tipo: 'contatto', canale: 'piccione', esito: 'risposto' }, OGGI).errore, /contattato/);
		assert.match(applicaAzione(nuovo, { tipo: 'contatto', canale: 'telefono' }, OGGI).errore, /risposto/);
	});

	test('un richiamo vuole una data da oggi in poi', () => {
		assert.equal(applicaAzione(nuovo, { tipo: 'richiamo', data: '2026-10-12' }, OGGI).campi.stato, 'da_richiamare');
		assert.match(applicaAzione(nuovo, { tipo: 'richiamo', data: fa(1) }, OGGI).errore, /passato/);
		assert.match(applicaAzione(nuovo, { tipo: 'richiamo' }, OGGI).errore, /quando/);
	});

	test('chiudere vuole un motivo, e con «altro» una nota', () => {
		const ok = applicaAzione(nuovo, { tipo: 'chiudi', motivo: 'prezzo' }, OGGI);
		assert.deepEqual(ok.campi, { stato: 'non_interessato', stato_dal: OGGI, motivo_chiusura: 'prezzo', richiamare_il: null });
		assert.match(applicaAzione(nuovo, { tipo: 'chiudi', motivo: 'altro' }, OGGI).errore, /nota/);
		assert.equal(applicaAzione(nuovo, { tipo: 'chiudi', motivo: 'altro', nota: 'Si trasferisce' }, OGGI).campi.stato, 'non_interessato');
	});

	test('un lead chiuso non si lavora finché non si riapre; riaperto riparte coi tentativi', () => {
		const chiuso = { ...nuovo, stato: 'non_raggiungibile', tentativi_senza_risposta: 3, ultimo_contatto_il: fa(20) };
		assert.match(applicaAzione(chiuso, { tipo: 'contatto', canale: 'telefono', esito: 'risposto' }, OGGI).errore, /chiuso/);
		const riaperto = applicaAzione(chiuso, { tipo: 'riapri' }, OGGI);
		assert.equal(riaperto.campi.stato, 'in_attesa');
		assert.equal(riaperto.campi.tentativi_senza_risposta, 0);
		assert.equal(daChiudereComeNonRaggiungibile({ ...chiuso, ...riaperto.campi }, OGGI), false, 'non si richiude da solo');
		assert.equal(applicaAzione({ ...nuovo, stato: 'non_interessato' }, { tipo: 'riapri' }, OGGI).campi.stato, 'nuovo', 'mai contattato: torna nuovo');
	});
});

describe('le condizioni di tempo', () => {
	const inAttesa = (giorni, tentativi = 1) => ({ ...nuovo, stato: 'in_attesa', tentativi_senza_risposta: tentativi, ultimo_contatto_il: fa(giorni) });

	test('in attesa: niente, poi da ricontattare, poi ultimo tentativo', () => {
		assert.deepEqual([...condizioniLead(inAttesa(SOGLIE_LEAD.sollecitoGiorni - 1), OGGI)], ['aperti']);
		assert.ok(condizioniLead(inAttesa(SOGLIE_LEAD.sollecitoGiorni), OGGI).has('da_ricontattare'));
		assert.ok(condizioniLead(inAttesa(SOGLIE_LEAD.ultimoTentativoGiorni - 1), OGGI).has('da_ricontattare'));
		const ultimo = condizioniLead(inAttesa(SOGLIE_LEAD.ultimoTentativoGiorni), OGGI);
		assert.ok(ultimo.has('ultimo_tentativo') && !ultimo.has('da_ricontattare'));
	});

	test('non raggiungibile da solo: tentativi bastanti e l\'ultimo abbastanza lontano, tutte e due', () => {
		const { tentativiMassimi: n, nonRaggiungibileGiorni: g } = SOGLIE_LEAD;
		assert.equal(daChiudereComeNonRaggiungibile(inAttesa(g, n), OGGI), true);
		assert.equal(daChiudereComeNonRaggiungibile(inAttesa(g - 1, n), OGGI), false);
		assert.equal(daChiudereComeNonRaggiungibile(inAttesa(g, n - 1), OGGI), false);
	});

	test('richiami di oggi, conversazioni ferme, da recuperare, chiusi', () => {
		assert.ok(condizioniLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: OGGI }, OGGI).has('richiami_oggi'));
		assert.ok(condizioniLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: fa(2) }, OGGI).has('richiami_oggi'), 'anche quelli passati');
		assert.ok(!condizioniLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: '2026-10-08' }, OGGI).has('richiami_oggi'));
		const ferma = { ...nuovo, stato: 'in_conversazione', ultima_risposta_il: fa(SOGLIE_LEAD.fermaGiorni), stato_dal: fa(SOGLIE_LEAD.fermaGiorni) };
		assert.ok(condizioniLead(ferma, OGGI).has('conversazioni_ferme'));
		const perso = { ...nuovo, stato: 'non_interessato', stato_dal: fa(SOGLIE_LEAD.recuperoGiorni) };
		assert.deepEqual([...condizioniLead(perso, OGGI)].sort(), ['chiusi', 'da_recuperare']);
	});

	test('i conteggi dei filtri', () => {
		const conti = contaFiltriLead([nuovo, inAttesa(4), { ...nuovo, stato: 'non_raggiungibile' }], OGGI);
		assert.equal(conti.aperti, 2);
		assert.equal(conti.da_contattare, 1);
		assert.equal(conti.da_ricontattare, 1);
		assert.equal(conti.chiusi, 1);
	});

	test('il tempo in una riga', () => {
		assert.equal(descriviTempoLead(inAttesa(10, 2), OGGI), 'contattato 10 giorni fa · 2 tentativi senza risposta');
		assert.equal(descriviTempoLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: '2026-10-12' }, OGGI), 'richiamare il 12/10/2026');
		assert.equal(descriviTempoLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: OGGI }, OGGI), 'richiamare oggi');
		assert.equal(descriviTempoLead({ ...nuovo, stato: 'da_richiamare', richiamare_il: fa(2) }, OGGI), 'richiamo in ritardo di 2 giorni');
		assert.equal(descriviTempoLead(nuovo, OGGI), 'arrivato 2 giorni fa');
	});
});
