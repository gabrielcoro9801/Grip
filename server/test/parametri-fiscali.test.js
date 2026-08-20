// Aliquote e soglie di legge, con la data da cui valgono.
//
// Erano costanti: `ALIQUOTA_IRES = 24`. Il problema non era che fossero fisse — sono legge,
// non preferenze — ma che valessero per qualunque data. L'applicazione calcola anche numeri
// di esercizi passati: dopo un cambio di aliquota, ricalcolare un anno vecchio avrebbe dato
// un risultato sbagliato, e sbagliato senza dare segno di sé.
import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { parametriFiscali } from '../src/db/schema/index.js';
import { parametroAllaData, valoreAllaData, parametriAllaData } from '../../shared/parametriFiscali.js';
import { stimaIres } from '../../shared/ires.js';
import { posizioneSoglia } from '../../shared/compensiSportivi.js';
import { calcolaRitenuta } from '../../shared/ritenuta.js';

// Una legge che cambia due volte: è il caso che le costanti non sapevano rappresentare.
const STORIA = [
	{ chiave: 'aliquota_ires', valore: 27.5, valido_dal: '2008-01-01' },
	{ chiave: 'aliquota_ires', valore: 24, valido_dal: '2017-01-01' },
	{ chiave: 'soglia_compensi_sportivi', valore: 10000, valido_dal: '2000-01-01' },
	{ chiave: 'soglia_compensi_sportivi', valore: 15000, valido_dal: '2023-07-01' },
];

after(async () => { await pool.end(); });

describe('il valore in vigore a una data', () => {
	test('prima del cambio vale quello vecchio', () => {
		assert.equal(valoreAllaData(STORIA, 'aliquota_ires', '2016-12-31'), 27.5);
	});

	test('dal giorno della decorrenza vale quello nuovo', () => {
		assert.equal(valoreAllaData(STORIA, 'aliquota_ires', '2017-01-01'), 24);
	});

	test('anni dopo continua a valere il più recente', () => {
		assert.equal(valoreAllaData(STORIA, 'aliquota_ires', '2030-06-15'), 24);
	});

	test('prima di qualunque decorrenza nota il valore non si inventa', () => {
		// Rispondere con l'aliquota più vecchia disponibile sarebbe peggio di non rispondere:
		// produrrebbe un numero plausibile che nessuno rimetterebbe in discussione.
		assert.throws(() => valoreAllaData(STORIA, 'aliquota_ires', '2005-01-01'), /Non è noto il valore/);
	});

	test("l'errore nomina il parametro in italiano, non la chiave tecnica", () => {
		assert.throws(
			() => valoreAllaData([], 'soglia_compensi_sportivi', '2026-01-01'),
			/Soglia di esenzione dei compensi sportivi/,
		);
	});

	test('la decorrenza e la norma restano leggibili', () => {
		const righe = [{ chiave: 'x', valore: 5, valido_dal: '2020-01-01', note: 'Art. 1 L. 1/2020' }];
		assert.deepEqual(parametroAllaData(righe, 'x', '2024-01-01'), {
			valore: 5, validoDal: '2020-01-01', note: 'Art. 1 L. 1/2020',
		});
	});

	test('parametriAllaData restituisce solo quelli noti a quella data', () => {
		const alle2016 = parametriAllaData(STORIA, '2016-06-01');
		assert.equal(alle2016.aliquota_ires, 27.5);
		assert.equal(alle2016.soglia_compensi_sportivi, 10000);
	});
});

describe('i calcoli non conoscono più le aliquote', () => {
	test("l'IRES si rifiuta di stimare senza i valori dell'esercizio", () => {
		assert.throws(() => stimaIres(100000, 0), /aliquota e coefficiente/);
		assert.throws(() => stimaIres(100000, 0, { aliquota: 24 }), /aliquota e coefficiente/);
	});

	test("lo stesso esercizio dà risultati diversi con aliquote di anni diversi", () => {
		const con2016 = stimaIres(100000, 0, { aliquota: 27.5, coefficiente: 3 });
		const con2017 = stimaIres(100000, 0, { aliquota: 24, coefficiente: 3 });
		assert.equal(con2016.imponibile, 3000);
		assert.equal(con2017.imponibile, 3000);
		assert.equal(con2016.imposta, 825);
		assert.equal(con2017.imposta, 720);
	});

	test('le plusvalenze entrano per intero, senza coefficiente', () => {
		const r = stimaIres(100000, 5000, { aliquota: 24, coefficiente: 3 });
		assert.equal(r.imponibile, 8000, '3.000 dai proventi + 5.000 di plusvalenze');
	});

	test('la soglia dei compensi sportivi va passata, non presunta', () => {
		assert.throws(() => posizioneSoglia({ giaLiquidato: 1000 }), /soglia di esenzione/);
	});

	test('lo stesso compenso è sotto o sopra soglia a seconda dell’anno', () => {
		const dati = { giaLiquidato: 11000, autocertificatoAltriEnti: 0, compensoInCorso: 0, dataAutocertificazione: '2023-01-01' };
		assert.equal(posizioneSoglia({ ...dati, soglia: 10000 }).giaOltreSoglia, true);
		assert.equal(posizioneSoglia({ ...dati, soglia: 15000 }).giaOltreSoglia, false);
	});

	test("la ritenuta usa l'aliquota del fornitore se c'è, altrimenti quella ordinaria", () => {
		const prof = { tipo_soggetto: 'professionista', regime_forfettario: false };
		assert.equal(calcolaRitenuta(prof, 1000, 20).ritenuta, 200);
		assert.equal(calcolaRitenuta({ ...prof, aliquota_ritenuta: 4 }, 1000, 20).ritenuta, 40);
	});

	test('senza aliquota da nessuna parte la ritenuta non si calcola a caso', () => {
		const prof = { tipo_soggetto: 'professionista', regime_forfettario: false };
		assert.throws(() => calcolaRitenuta(prof, 1000, undefined), /aliquota della ritenuta/);
	});
});

describe('i valori seminati in banca dati', () => {
	test("l'archivio conosce tutti e quattro i parametri", async () => {
		const righe = (await db.select().from(parametriFiscali))
			.map((r) => ({ chiave: r.chiave, valore: r.valore, valido_dal: r.validoDal, note: r.note }));
		for (const chiave of ['aliquota_ires', 'coefficiente_redditivita_398', 'soglia_compensi_sportivi', 'aliquota_ritenuta_acconto']) {
			assert.ok(parametroAllaData(righe, chiave, '2026-12-31'), `manca ${chiave}`);
		}
	});

	test('ogni valore dichiara la norma da cui viene', async () => {
		// Senza, fra tre anni nessuno saprebbe da dove esce il numero.
		const righe = await db.select().from(parametriFiscali);
		const senzaNota = righe.filter((r) => !r.note?.trim());
		assert.deepEqual(senzaNota.map((r) => r.chiave), []);
	});

	test("l'IRES del 2016 non è nota, e va bene così", async () => {
		// Il 24% vale dal 2017: retrodatarlo avrebbe significato affermare il falso.
		const righe = (await db.select().from(parametriFiscali).where(eq(parametriFiscali.chiave, 'aliquota_ires')))
			.map((r) => ({ chiave: r.chiave, valore: r.valore, valido_dal: r.validoDal }));
		assert.equal(parametroAllaData(righe, 'aliquota_ires', '2016-12-31'), null);
		assert.equal(parametroAllaData(righe, 'aliquota_ires', '2017-01-01').valore, 24);
	});
});
