// Le regole di calcolo di una scheda e di un allenamento.
//
// Sono funzioni pure, ma decidono numeri che il socio e il suo istruttore leggono come
// fatti: il volume di una seduta, se una serie è un record, dove finisce il recupero in un
// superset. Un errore qui non fa cadere niente — fa dire all'applicazione una cosa falsa
// con la faccia sicura, che è il modo peggiore di sbagliare.
//
// Girano con `node --test`: il modulo non importa niente di React né l'alias di Vite.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	statisticheAllenamento,
	massimaleStimato,
	recordPerEsercizio,
	raggruppaPerSuperset,
	ultimoDelGiro,
	prossimaLetteraGruppo,
	formatDurata,
	formatConteggio,
	formatRecupero,
	riepilogoSerie,
	riepilogoRpe,
	motivoNonSalvabile,
	clonaRoutines,
	sposta,
	totaleSerieScheda,
	durataSessione,
	tipoSerie,
	statisticheSettimanali,
	togliGruppiOrfani,
} from './scheda.js';

describe('volume e serie di un allenamento', () => {
	test('somma carico per ripetizioni', () => {
		const { serie, volume } = statisticheAllenamento([
			{ peso_usato: 60, reps_fatte: 8 },
			{ peso_usato: 60, reps_fatte: 8 },
		]);
		assert.equal(serie, 2);
		assert.equal(volume, 960);
	});

	test('il riscaldamento non entra nel volume, ed è il motivo per cui lo si distingue', () => {
		const { serie, volume } = statisticheAllenamento([
			{ peso_usato: 20, reps_fatte: 12, tipo_serie: 'riscaldamento' },
			{ peso_usato: 60, reps_fatte: 8, tipo_serie: 'normale' },
		]);
		assert.equal(serie, 1, 'il riscaldamento non conta nemmeno come serie');
		assert.equal(volume, 480);
	});

	test('drop set e cedimento invece contano: sono lavoro', () => {
		const { serie, volume } = statisticheAllenamento([
			{ peso_usato: 50, reps_fatte: 10, tipo_serie: 'dropset' },
			{ peso_usato: 50, reps_fatte: 6, tipo_serie: 'cedimento' },
		]);
		assert.equal(serie, 2);
		assert.equal(volume, 800);
	});

	test('legge sia le righe registrate sia quelle in lavorazione nella sessione', () => {
		// `peso_usato`/`reps_fatte` arrivano dall'API, `kg`/`reps` sono le stesse cose
		// mentre il socio le sta scrivendo: il conto deve tornare identico.
		const daApi = statisticheAllenamento([{ peso_usato: 40, reps_fatte: 5 }]);
		const inCorso = statisticheAllenamento([{ kg: 40, reps: 5 }]);
		assert.deepEqual(daApi, inCorso);
	});

	test('a corpo libero il volume resta zero senza rompersi', () => {
		const { serie, volume } = statisticheAllenamento([{ reps_fatte: 15 }]);
		assert.equal(serie, 1);
		assert.equal(volume, 0);
	});

	test('un tipo sconosciuto vale come serie di lavoro', () => {
		// Una riga scritta da una versione futura non deve sparire dal conto.
		assert.equal(tipoSerie('qualcosa-di-nuovo').volume, true);
		assert.equal(statisticheAllenamento([{ peso_usato: 10, reps_fatte: 10, tipo_serie: 'boh' }]).serie, 1);
	});
});

describe('massimale stimato e record', () => {
	test('Epley: kg × (1 + reps/30)', () => {
		assert.equal(massimaleStimato(100, 1), 103.3);
		assert.equal(massimaleStimato(60, 10), 80);
	});

	test('sopra le dodici ripetizioni non si stima', () => {
		// La formula sovrastima, e un numero in cui nessuno crede è peggio di nessun numero.
		assert.equal(massimaleStimato(40, 20), null);
	});

	test('senza carico o senza ripetizioni non si stima niente', () => {
		assert.equal(massimaleStimato(null, 8), null);
		assert.equal(massimaleStimato(60, null), null);
		assert.equal(massimaleStimato(0, 8), null);
	});

	test('il record è la serie col massimale più alto, non col peso più alto', () => {
		// 100×1 = 103.3 stimati, 80×8 = 101.3: il singolo vince, ma di poco e per il
		// motivo giusto. Con 90×8 (114) il confronto si ribalta, ed è quello che conta.
		const record = recordPerEsercizio([
			{ exercise_name: 'Panca', peso_usato: 100, reps_fatte: 1, data: '2026-01-01' },
			{ exercise_name: 'Panca', peso_usato: 90, reps_fatte: 8, data: '2026-02-01' },
		]);
		assert.equal(record.get('Panca').peso, 90);
		assert.equal(record.get('Panca').reps, 8);
	});

	test('il riscaldamento non può diventare un record', () => {
		const record = recordPerEsercizio([
			{ exercise_name: 'Panca', peso_usato: 200, reps_fatte: 1, tipo_serie: 'riscaldamento' },
			{ exercise_name: 'Panca', peso_usato: 60, reps_fatte: 5, tipo_serie: 'normale' },
		]);
		assert.equal(record.get('Panca').peso, 60);
	});
});

describe('superset', () => {
	const esercizi = [
		{ exercise_name: 'Panca', gruppo: 'A' },
		{ exercise_name: 'Rematore', gruppo: 'A' },
		{ exercise_name: 'Squat', gruppo: null },
	];

	test('gli esercizi adiacenti con la stessa lettera fanno un giro solo', () => {
		const gruppi = raggruppaPerSuperset(esercizi);
		assert.equal(gruppi.length, 2);
		assert.equal(gruppi[0].esercizi.length, 2);
		assert.equal(gruppi[1].esercizi.length, 1);
	});

	test('il recupero parte solo dopo l’ultimo del giro', () => {
		// È la regola che rende un superset un superset: fra A1 e A2 non si riposa.
		assert.equal(ultimoDelGiro(esercizi, 0), false, 'dopo A1 non si recupera');
		assert.equal(ultimoDelGiro(esercizi, 1), true, 'dopo A2 sì');
		assert.equal(ultimoDelGiro(esercizi, 2), true, 'un esercizio solo recupera sempre');
	});

	test('due esercizi con la stessa lettera ma separati non sono un giro', () => {
		// Non è un superset, è un errore di compilazione: nasconderlo lo renderebbe
		// impossibile da notare.
		const sparsi = [
			{ exercise_name: 'Panca', gruppo: 'A' },
			{ exercise_name: 'Squat', gruppo: null },
			{ exercise_name: 'Rematore', gruppo: 'A' },
		];
		assert.equal(raggruppaPerSuperset(sparsi).length, 3);
	});

	test('chi resta solo nel giro perde la lettera', () => {
		// Spostando un esercizio fuori dal superset la lettera restava addosso a entrambi,
		// e ognuno mostrava un «Superset A» per un gruppo di uno.
		const spezzato = [
			{ exercise_name: 'Panca', gruppo: 'A' },
			{ exercise_name: 'Squat', gruppo: null },
			{ exercise_name: 'Rematore', gruppo: 'A' },
		];
		assert.deepEqual(togliGruppiOrfani(spezzato).map((e) => e.gruppo), [null, null, null]);
	});

	test('un superset ancora intero non viene toccato', () => {
		assert.deepEqual(togliGruppiOrfani(esercizi).map((e) => e.gruppo), ['A', 'A', null]);
	});

	test('la lettera nuova è la prima libera', () => {
		assert.equal(prossimaLetteraGruppo(esercizi), 'B');
		assert.equal(prossimaLetteraGruppo([]), 'A');
	});
});

describe('come si leggono i tempi', () => {
	test('la durata mostra i secondi finché è corta', () => {
		// Un cronometro fermo su "00:00" per un minuto sembra rotto.
		assert.equal(formatDurata(4), '4s');
		assert.equal(formatDurata(90), '1:30');
		assert.equal(formatDurata(3860), '1:04:20');
	});

	test('il conto alla rovescia è sempre M:SS', () => {
		assert.equal(formatConteggio(90), '1:30');
		assert.equal(formatConteggio(5), '0:05');
		assert.equal(formatConteggio(-3), '0:00', 'sotto zero si ferma');
	});

	test('il recupero si scrive come lo si dice', () => {
		assert.equal(formatRecupero(45), '45"');
		assert.equal(formatRecupero(60), "1'");
		assert.equal(formatRecupero(90), '1\' 30"');
		assert.equal(formatRecupero(null), '');
		assert.equal(formatRecupero(0), '');
	});

	test('una sessione ancora aperta dura fino ad adesso', () => {
		const iniziata = new Date('2026-09-10T10:00:00Z').toISOString();
		const adesso = new Date('2026-09-10T10:05:00Z').getTime();
		assert.equal(durataSessione({ iniziata_alle: iniziata }, adesso), 300);
		assert.equal(
			durataSessione({ iniziata_alle: iniziata, terminata_alle: new Date('2026-09-10T10:02:00Z').toISOString() }, adesso),
			120,
			'una chiusa si ferma dove è finita',
		);
	});
});

describe('il riepilogo di un esercizio', () => {
	test('serie uguali si comprimono in 4×8', () => {
		assert.equal(riepilogoSerie({ serie: [{ reps: '8' }, { reps: '8' }] }), '2×8');
	});

	test('le piramidali si scrivono per esteso', () => {
		// Comprimerle mostrerebbe un numero che nella scheda non c'è scritto da nessuna parte.
		assert.equal(riepilogoSerie({ serie: [{ reps: '12' }, { reps: '10' }, { reps: '8' }] }), '12 · 10 · 8');
	});

	test("l'RPE si mostra come intervallo quando varia", () => {
		assert.equal(riepilogoRpe({ serie: [{ rpe: 7 }, { rpe: 9 }] }), 'RPE 7-9');
		assert.equal(riepilogoRpe({ serie: [{ rpe: 8 }, { rpe: 8 }] }), 'RPE 8');
		assert.equal(riepilogoRpe({ serie: [{ rpe: null }] }), '');
	});
});

describe('cosa impedisce di salvare una scheda', () => {
	const routineValida = { nome: 'Giorno 1', esercizi: [{ exercise_name: 'Panca', serie: [{ reps: '8' }] }] };

	test('una scheda completa si salva', () => {
		assert.equal(
			motivoNonSalvabile({ name: 'Forza', isTemplate: true, routines: [routineValida] }),
			null,
		);
	});

	test('un modello non ha bisogno del socio, una scheda assegnata sì', () => {
		assert.equal(motivoNonSalvabile({ name: 'Forza', isTemplate: true, routines: [routineValida] }), null);
		assert.match(
			motivoNonSalvabile({ name: 'Forza', isTemplate: false, memberId: '', routines: [routineValida] }),
			/socio/,
		);
	});

	test('ogni motivo nomina la cosa che manca', () => {
		assert.match(motivoNonSalvabile({ name: '  ', isTemplate: true, routines: [routineValida] }), /nome/);
		assert.match(motivoNonSalvabile({ name: 'Forza', isTemplate: true, routines: [] }), /routine/);
		assert.match(
			motivoNonSalvabile({ name: 'Forza', isTemplate: true, routines: [{ nome: 'Giorno 1', esercizi: [] }] }),
			/Giorno 1/,
		);
		assert.match(
			motivoNonSalvabile({
				name: 'Forza',
				isTemplate: true,
				routines: [{ nome: 'Giorno 1', esercizi: [{ exercise_name: 'Panca', serie: [] }] }],
			}),
			/Panca/,
		);
	});
});

describe('quante volte ci si allena', () => {
	// Mercoledì 10 settembre 2026, ora locale: la settimana corrente parte da lunedì 8.
	const mercoledi = new Date(2026, 8, 10, 12, 0, 0).getTime();
	const seduta = (quando) => ({
		iniziata_alle: new Date(quando).toISOString(),
		terminata_alle: new Date(quando + 3600000).toISOString(),
	});

	test('conta le sedute della settimana e del mese', () => {
		const s = statisticheSettimanali(
			[
				seduta(new Date(2026, 8, 8, 10).getTime()), // lunedì, questa settimana
				seduta(new Date(2026, 8, 9, 10).getTime()), // martedì, questa settimana
				seduta(new Date(2026, 8, 3, 10).getTime()), // settimana prima, stesso mese
				seduta(new Date(2026, 7, 20, 10).getTime()), // mese prima
			],
			mercoledi,
		);
		assert.equal(s.questaSettimana, 2);
		assert.equal(s.questoMese, 3);
	});

	test('un allenamento non terminato non conta', () => {
		// È in corso: contarlo direbbe che ci si è allenati quando non è ancora finita.
		const s = statisticheSettimanali(
			[{ iniziata_alle: new Date(2026, 8, 9, 10).toISOString(), terminata_alle: null }],
			mercoledi,
		);
		assert.equal(s.questaSettimana, 0);
	});

	test('la fila conta le settimane consecutive', () => {
		const s = statisticheSettimanali(
			[
				seduta(new Date(2026, 8, 9, 10).getTime()), // questa
				seduta(new Date(2026, 8, 2, 10).getTime()), // -1
				seduta(new Date(2026, 7, 26, 10).getTime()), // -2
			],
			mercoledi,
		);
		assert.equal(s.settimaneDiFila, 3);
	});

	test('una settimana saltata interrompe la fila', () => {
		const s = statisticheSettimanali(
			[
				seduta(new Date(2026, 8, 9, 10).getTime()), // questa
				// niente nella settimana del 31 agosto
				seduta(new Date(2026, 7, 26, 10).getTime()),
			],
			mercoledi,
		);
		assert.equal(s.settimaneDiFila, 1);
	});

	test('non essersi ancora allenati questa settimana non azzera la fila', () => {
		// Altrimenti ogni domenica a mezzanotte la fila tornerebbe a zero, e sarebbe una
		// misura che punisce chi si allena il mercoledì.
		const s = statisticheSettimanali(
			[
				seduta(new Date(2026, 8, 2, 10).getTime()), // -1
				seduta(new Date(2026, 7, 26, 10).getTime()), // -2
			],
			mercoledi,
		);
		assert.equal(s.settimaneDiFila, 2);
	});

	test("l'ora legale non spezza la fila", () => {
		// L'ultima domenica di marzo 2026 (29 marzo) l'Italia passa all'ora legale: la
		// settimana che la contiene dura 167 ore, non 168. Tornando indietro di sette per
		// 86.400.000 millisecondi il cursore cadeva alle 23 della domenica invece che a
		// mezzanotte del lunedì, il confronto falliva e una fila di mesi si azzerava.
		const dopoIlCambio = new Date(2026, 3, 1, 12, 0, 0).getTime(); // mercoledì 1 aprile
		const seduta = (quando) => ({
			iniziata_alle: new Date(quando).toISOString(),
			terminata_alle: new Date(quando + 3600000).toISOString(),
		});
		const s = statisticheSettimanali(
			[
				seduta(new Date(2026, 2, 31, 10).getTime()), // settimana del 30 marzo
				seduta(new Date(2026, 2, 25, 10).getTime()), // settimana del 23 marzo, a cavallo
				seduta(new Date(2026, 2, 18, 10).getTime()), // settimana del 16 marzo
			],
			dopoIlCambio,
		);
		assert.equal(s.settimaneDiFila, 3);
	});

	test('senza allenamenti la fila è zero', () => {
		assert.deepEqual(statisticheSettimanali([], mercoledi), {
			questaSettimana: 0,
			questoMese: 0,
			settimaneDiFila: 0,
		});
	});
});

describe('copiare e spostare', () => {
	test('la copia di una scheda non resta legata all’originale', () => {
		// Senza copia profonda, correggere la scheda di un socio cambierebbe il modello di
		// tutti gli altri: è il difetto che questa funzione esiste per impedire.
		const originale = [{ nome: 'Giorno 1', esercizi: [{ exercise_name: 'Panca', serie: [{ reps: '8' }] }] }];
		const copia = clonaRoutines(originale);
		copia[0].esercizi[0].serie[0].reps = '12';
		copia[0].nome = 'Cambiato';
		assert.equal(originale[0].esercizi[0].serie[0].reps, '8');
		assert.equal(originale[0].nome, 'Giorno 1');
	});

	test('spostare fuori dai bordi non fa niente', () => {
		assert.deepEqual(sposta(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
		assert.deepEqual(sposta(['a', 'b'], 0, -1), ['a', 'b']);
		assert.deepEqual(sposta(['a', 'b'], 1, 2), ['a', 'b']);
	});

	test('le serie si contano su tutte le routine', () => {
		assert.equal(
			totaleSerieScheda([
				{ esercizi: [{ serie: [1, 2, 3] }] },
				{ esercizi: [{ serie: [1] }, { serie: [1, 2] }] },
			]),
			6,
		);
	});
});
