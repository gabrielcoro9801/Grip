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
	tokenSocio = await login(account[1].email);
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
	await db.delete(staffAccounts).where(inArray(staffAccounts.nome, ['PT Di Prova']));
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
