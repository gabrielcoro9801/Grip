// Il giro completo di una scheda di allenamento, dalle rotte vere.
//
// Copre il percorso che attraversa più pezzi e che nessun altro test tocca: il personal
// trainer cataloga un esercizio, compone un modello diviso in routine, lo assegna a un
// socio, e il socio avvia una routine e spunta le serie una per una.
//
// Il test si costruisce i propri dati e li cancella alla fine: non dipende da com'è
// popolato il database in cui gira.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, exercises, exercisePlans, workoutSessions, workoutLogs } from '../src/db/schema/index.js';

const PASSWORD = 'prova-allenamento-1234';

let app;
let tokenPt;
let tokenSocio;
let tokenReception;
let idSocio;
let idEsercizio;
let idModello;
let idScheda;
let idSessione;

function come(token, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}`, ...opzioni.headers } });
}

async function login(email) {
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
	assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
	return res.json().token;
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const suffisso = Date.now();
	const [socio] = await db
		.insert(members)
		.values({ fullName: 'Socio Allenamento', email: `socio.all.${suffisso}@test.local` })
		.returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'PT Di Prova', email: `pt.all.${suffisso}@test.local`, passwordHash, ruolo: 'admin' },
			{ nome: 'Reception Di Prova', email: `rec.all.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{
				nome: 'Socio Allenamento',
				email: `socio.all.${suffisso}@test.local`,
				passwordHash,
				ruolo: 'member',
				linkedMemberId: socio.id,
			},
		])
		.returning();

	tokenPt = await login(account[0].email);
	tokenReception = await login(account[1].email);
	tokenSocio = await login(account[2].email);
});

after(async () => {
	if (idSessione) await db.delete(workoutLogs).where(inArray(workoutLogs.sessionId, [idSessione]));
	if (idSessione) await db.delete(workoutSessions).where(inArray(workoutSessions.id, [idSessione]));
	const schede = [idModello, idScheda].filter(Boolean);
	if (schede.length) await db.delete(exercisePlans).where(inArray(exercisePlans.id, schede));
	if (idEsercizio) await db.delete(exercises).where(inArray(exercises.id, [idEsercizio]));
	if (idSocio) {
		await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, [idSocio]));
		await db.delete(staffAccounts).where(inArray(staffAccounts.email, [`pt.all.${idSocio}@test.local`]));
	}
	// L'account del PT non è collegato a un socio: si riconosce solo dal nome di prova.
	await db.delete(staffAccounts).where(inArray(staffAccounts.nome, ['PT Di Prova', 'Reception Di Prova']));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await app.close();
	await pool.end();
});

describe('il personal trainer compone una scheda', () => {
	test('cataloga un esercizio con nome, gruppo muscolare e descrizione', async () => {
		const res = await come(tokenPt, {
			method: 'POST',
			url: '/api/entities/Exercise',
			payload: {
				name: 'Panca piana di prova',
				muscle_group: 'petto',
				description: 'Scapole addotte, bilanciere allo sterno.',
			},
		});
		assert.equal(res.statusCode, 201);
		idEsercizio = res.json().id;
		assert.equal(res.json().muscle_group, 'petto');
		assert.equal(res.json().description, 'Scapole addotte, bilanciere allo sterno.');
	});

	test('crea un modello diviso in routine, ognuna con le sue serie', async () => {
		const res = await come(tokenPt, {
			method: 'POST',
			url: '/api/entities/ExercisePlan',
			payload: {
				is_template: true,
				name: 'Modello di prova',
				notes: 'Tre volte a settimana.',
				routines: [
					{
						nome: 'Giorno 1 — Spinta',
						note: 'Riscaldamento 10 minuti.',
						esercizi: [
							{
								exercise_id: idEsercizio,
								exercise_name: 'Panca piana di prova',
								muscle_group: 'petto',
								recupero_secondi: 90,
								note: 'Tenuta di 1 secondo.',
								serie: [
									{ reps: '8', rpe: 7 },
									{ reps: '8', rpe: 8 },
									{ reps: '6', rpe: 8.5 },
								],
							},
						],
					},
					{ nome: 'Giorno 2 — Tirata', note: '', esercizi: [] },
				],
			},
		});
		assert.equal(res.statusCode, 201);
		idModello = res.json().id;

		const salvato = res.json();
		assert.equal(salvato.is_template, true);
		assert.equal(salvato.member_id, null, 'un modello non è di nessuno');
		assert.equal(salvato.routines.length, 2);
		assert.equal(salvato.routines[0].esercizi[0].serie.length, 3);
		// Il mezzo punto di RPE deve sopravvivere al giro nel database.
		assert.equal(salvato.routines[0].esercizi[0].serie[2].rpe, 8.5);
		assert.equal(salvato.routines[0].esercizi[0].recupero_secondi, 90);
	});

	test('assegna una copia al socio, e la copia è indipendente dal modello', async () => {
		const modello = (await come(tokenPt, { method: 'GET', url: `/api/entities/ExercisePlan/${idModello}` })).json();

		const res = await come(tokenPt, {
			method: 'POST',
			url: '/api/entities/ExercisePlan',
			payload: {
				is_template: false,
				member_id: idSocio,
				member_name: 'Socio Allenamento',
				name: 'Forza — prova',
				notes: modello.notes,
				routines: modello.routines,
				assigned_date: '2026-09-10',
				template_origin_id: idModello,
			},
		});
		assert.equal(res.statusCode, 201);
		idScheda = res.json().id;
		assert.equal(res.json().template_origin_id, idModello);

		// Cambiare la scheda del socio non deve toccare il modello: è quello che rende
		// sicuro adattare una scheda alla persona che ce l'ha.
		const adattata = JSON.parse(JSON.stringify(modello.routines));
		adattata[0].esercizi[0].serie[0].reps = '12';
		await come(tokenPt, {
			method: 'PUT',
			url: `/api/entities/ExercisePlan/${idScheda}`,
			payload: { routines: adattata },
		});

		const modelloDopo = (await come(tokenPt, { method: 'GET', url: `/api/entities/ExercisePlan/${idModello}` })).json();
		assert.equal(modelloDopo.routines[0].esercizi[0].serie[0].reps, '8', 'il modello non deve essere cambiato');
	});
});

describe('il socio si allena', () => {
	test('vede la scheda che gli è stata assegnata, e non il modello', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: '/api/entities/ExercisePlan' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(res.json().map((s) => s.name), ['Forza — prova']);
	});

	test('avvia una routine: la sessione nasce aperta', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutSession',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				plan_name: 'Forza — prova',
				routine_index: 0,
				routine_name: 'Giorno 1 — Spinta',
				iniziata_alle: new Date().toISOString(),
			},
		});
		assert.equal(res.statusCode, 201);
		idSessione = res.json().id;
		assert.equal(res.json().terminata_alle, null, 'una sessione appena avviata è in corso');
	});

	test('spunta le serie una per una, e ognuna finisce subito nel database', async () => {
		for (const [indice, serie] of [[0, { peso: 60, reps: 8, rpe: 7 }], [1, { peso: 60, reps: 8, rpe: 8 }]]) {
			const res = await come(tokenSocio, {
				method: 'POST',
				url: '/api/entities/WorkoutLog',
				payload: {
					member_id: idSocio,
					plan_id: idScheda,
					session_id: idSessione,
					exercise_index: 0,
					set_index: indice,
					exercise_name: 'Panca piana di prova',
					muscle_group: 'petto',
					peso_usato: serie.peso,
					reps_fatte: serie.reps,
					rpe_percepito: serie.rpe,
					data: '2026-09-10',
				},
			});
			assert.equal(res.statusCode, 201);
		}

		const registrate = (await come(tokenSocio, { method: 'GET', url: '/api/entities/WorkoutLog' })).json()
			.filter((r) => r.session_id === idSessione);
		assert.equal(registrate.length, 2);
		assert.deepEqual(registrate.map((r) => r.set_index).sort(), [0, 1]);
	});

	test("l'RPE a mezzo punto non viene troncato", async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutLog',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				session_id: idSessione,
				exercise_index: 0,
				set_index: 2,
				exercise_name: 'Panca piana di prova',
				peso_usato: 62.5,
				reps_fatte: 6,
				rpe_percepito: 8.5,
				data: '2026-09-10',
			},
		});
		assert.equal(res.statusCode, 201);
		// Su una colonna intera 8.5 sarebbe tornato 8, cioè un allenamento più facile di
		// com'è stato.
		assert.equal(Number(res.json().rpe_percepito), 8.5);
	});

	test('togliere la spunta cancella la serie registrata', async () => {
		const registrate = (await come(tokenSocio, { method: 'GET', url: '/api/entities/WorkoutLog' })).json()
			.filter((r) => r.session_id === idSessione && r.set_index === 2);
		assert.equal(registrate.length, 1);

		const res = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/WorkoutLog/${registrate[0].id}` });
		assert.equal(res.statusCode, 200);

		const dopo = (await come(tokenSocio, { method: 'GET', url: '/api/entities/WorkoutLog' })).json()
			.filter((r) => r.session_id === idSessione);
		assert.equal(dopo.length, 2, 'restano solo le due serie spuntate');
	});

	test('termina: la sessione si chiude, e le serie restano attaccate a lei', async () => {
		const res = await come(tokenSocio, {
			method: 'PUT',
			url: `/api/entities/WorkoutSession/${idSessione}`,
			payload: { terminata_alle: new Date().toISOString() },
		});
		assert.equal(res.statusCode, 200);
		assert.ok(res.json().terminata_alle, 'la sessione deve risultare chiusa');

		const registrate = (await come(tokenSocio, { method: 'GET', url: '/api/entities/WorkoutLog' })).json()
			.filter((r) => r.session_id === idSessione);
		assert.equal(registrate.length, 2);
	});

	test('non tocca la propria scheda: quella la scrive il personal trainer', async () => {
		const res = await come(tokenSocio, {
			method: 'PUT',
			url: `/api/entities/ExercisePlan/${idScheda}`,
			payload: { name: 'Me la riscrivo io' },
		});
		assert.equal(res.statusCode, 403);
	});
});

describe('tipi di serie e superset', () => {
	test('una routine con un superset e serie di riscaldamento si salva e si rilegge', async () => {
		const res = await come(tokenPt, {
			method: 'PUT',
			url: `/api/entities/ExercisePlan/${idScheda}`,
			payload: {
				routines: [
					{
						nome: 'Giorno 1 — Spinta',
						note: '',
						esercizi: [
							{
								exercise_id: idEsercizio,
								exercise_name: 'Panca piana di prova',
								muscle_group: 'petto',
								// Stessa lettera su due esercizi adiacenti: si fanno di fila.
								gruppo: 'A',
								recupero_secondi: 90,
								note: '',
								serie: [
									{ reps: '12', rpe: null, tipo: 'riscaldamento' },
									{ reps: '8', rpe: 8, tipo: 'normale' },
									{ reps: '6', rpe: 9, tipo: 'cedimento' },
								],
							},
							{
								exercise_id: null,
								exercise_name: 'Croci ai cavi',
								muscle_group: 'petto',
								gruppo: 'A',
								recupero_secondi: 60,
								note: '',
								serie: [{ reps: '15', rpe: 8, tipo: 'normale' }],
							},
						],
					},
				],
			},
		});
		assert.equal(res.statusCode, 200);

		const riletta = res.json().routines[0].esercizi;
		assert.equal(riletta[0].gruppo, 'A');
		assert.equal(riletta[1].gruppo, 'A', 'i due esercizi restano nello stesso giro');
		assert.deepEqual(
			riletta[0].serie.map((s) => s.tipo),
			['riscaldamento', 'normale', 'cedimento'],
		);
	});

	test('il tipo di una serie eseguita viene congelato sulla riga registrata', async () => {
		// Congelato e non ricavato dalla scheda: se domani quel riscaldamento diventa una
		// serie di lavoro, gli allenamenti già fatti non devono ricalcolarsi da soli.
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutLog',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				session_id: idSessione,
				exercise_index: 0,
				set_index: 5,
				exercise_name: 'Panca piana di prova',
				tipo_serie: 'riscaldamento',
				peso_usato: 20,
				reps_fatte: 12,
				data: '2026-09-10',
			},
		});
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().tipo_serie, 'riscaldamento');
	});

	test('senza indicazione una serie vale come serie di lavoro', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutLog',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				session_id: idSessione,
				exercise_index: 0,
				set_index: 6,
				exercise_name: 'Panca piana di prova',
				peso_usato: 60,
				reps_fatte: 8,
				data: '2026-09-10',
			},
		});
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().tipo_serie, 'normale', 'è il valore predefinito della colonna');
	});
});

describe("annullare un allenamento", () => {
	// Serve una via d'uscita: una sessione aperta impedisce di avviarne un'altra, quindi un
	// allenamento iniziato per sbaglio bloccherebbe il socio per sempre.
	let idDaButtare;
	let idRigaDaButtare;

	test('si avvia e ci si registra una serie', async () => {
		const sessione = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutSession',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				plan_name: 'Forza — prova',
				routine_index: 0,
				routine_name: 'Giorno 1 — Spinta',
				iniziata_alle: new Date().toISOString(),
			},
		});
		assert.equal(sessione.statusCode, 201);
		idDaButtare = sessione.json().id;

		const riga = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutLog',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				session_id: idDaButtare,
				exercise_index: 0,
				set_index: 0,
				exercise_name: 'Panca piana di prova',
				peso_usato: 50,
				reps_fatte: 10,
				data: '2026-09-10',
			},
		});
		assert.equal(riga.statusCode, 201);
		idRigaDaButtare = riga.json().id;
	});

	test('la sessione non si cancella finché le sue serie sono lì', async () => {
		// È il motivo per cui il portale cancella prima le righe: la chiave esterna punta
		// da quelle alla sessione, e invertire l'ordine fa fallire l'annullamento a metà.
		const res = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/WorkoutSession/${idDaButtare}` });
		assert.notEqual(res.statusCode, 200, 'il vincolo deve impedirlo');
	});

	test("nell'ordine giusto invece sparisce tutto", async () => {
		const riga = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/WorkoutLog/${idRigaDaButtare}` });
		assert.equal(riga.statusCode, 200);

		const sessione = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/WorkoutSession/${idDaButtare}` });
		assert.equal(sessione.statusCode, 200);

		const rimaste = (await come(tokenSocio, { method: 'GET', url: '/api/entities/WorkoutSession' })).json();
		assert.deepEqual(rimaste.filter((s) => s.id === idDaButtare), [], 'la sessione non deve esserci più');
	});
});

describe('cosa vede il personal trainer', () => {
	test("legge gli allenamenti dei soci: è il motivo per cui il socio li registra", async () => {
		const sessioni = await come(tokenPt, { method: 'GET', url: '/api/entities/WorkoutSession' });
		assert.equal(sessioni.statusCode, 200);
		assert.ok(
			sessioni.json().some((s) => s.id === idSessione),
			"l'allenamento del socio deve comparire allo staff",
		);

		const righe = await come(tokenPt, { method: 'GET', url: '/api/entities/WorkoutLog' });
		assert.equal(righe.statusCode, 200);
		const sue = righe.json().filter((r) => r.session_id === idSessione);
		// Le prime due serie spuntate dal socio, con i carichi che ha usato: è quello che
		// il personal trainer deve poter rileggere. Il conteggio non è fissato perché
		// altri test aggiungono righe alla stessa sessione.
		assert.ok(sue.length >= 2, 'le serie spuntate devono essere visibili allo staff');
		assert.ok(
			sue.some((r) => r.set_index === 0 && Number(r.peso_usato) === 60 && r.reps_fatte === 8),
			'con peso e ripetizioni di ogni serie',
		);
	});

	test('ma non li riscrive: il diario è di chi si allena', async () => {
		// Nemmeno l'amministratore. Correggere dall'esterno lo storico di una persona
		// significherebbe cambiare quello che ha fatto senza che se ne accorga: chi si
		// allena sistema i propri errori, e l'istruttore, se vede un numero strano, glielo
		// fa notare.
		for (const [chi, token] of [['la reception', tokenReception], ["l'amministratore", tokenPt]]) {
			const lettura = await come(token, { method: 'GET', url: '/api/entities/WorkoutSession' });
			assert.equal(lettura.statusCode, 200, `${chi} deve poterli leggere`);

			const scrittura = await come(token, {
				method: 'PUT',
				url: `/api/entities/WorkoutSession/${idSessione}`,
				payload: { note: 'ci metto mano io' },
			});
			assert.equal(scrittura.statusCode, 403, `${chi} non deve poterli riscrivere`);

			const cancellazione = await come(token, {
				method: 'DELETE',
				url: `/api/entities/WorkoutSession/${idSessione}`,
			});
			assert.equal(cancellazione.statusCode, 403, `${chi} non deve poterli cancellare`);
		}
	});

	test('il socio invece corregge e cancella i propri', async () => {
		// È la via d'uscita da un allenamento creato per sbaglio: senza, resterebbe per
		// sempre nel volume, nel conteggio delle sedute e nei record.
		const sessione = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutSession',
			payload: {
				member_id: idSocio,
				plan_id: idScheda,
				plan_name: 'Forza — prova',
				routine_index: 0,
				routine_name: 'Giorno 1 — Spinta',
				iniziata_alle: new Date().toISOString(),
				terminata_alle: new Date().toISOString(),
			},
		});
		assert.equal(sessione.statusCode, 201);
		const id = sessione.json().id;

		const correzione = await come(tokenSocio, {
			method: 'PUT',
			url: `/api/entities/WorkoutSession/${id}`,
			payload: { note: 'giornata storta' },
		});
		assert.equal(correzione.statusCode, 200, 'una seduta chiusa resta correggibile');

		const cancellazione = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/WorkoutSession/${id}` });
		assert.equal(cancellazione.statusCode, 200, 'e cancellabile');
	});
});
