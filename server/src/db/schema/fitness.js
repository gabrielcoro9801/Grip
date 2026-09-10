// Dominio fitness: Exercise, ExercisePlan, WorkoutLog.
import { pgTable, uuid, varchar, text, integer, numeric, date, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { members } from './crm.js';

// Il catalogo degli esercizi: cosa sono, non come si eseguono in una scheda.
// Serie, ripetizioni e recupero non stanno qui perché cambiano da scheda a scheda —
// lo stesso stacco è 5×5 per uno e 3×12 per un altro. Qui resta solo ciò che è vero
// dell'esercizio in sé.
export const exercises = pgTable('exercises', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	// Codice da shared/gruppiMuscolari.js (es. 'petto', 'dorsali').
	muscleGroup: varchar('muscle_group', { length: 32 }),
	description: text('description'),
});

// Una scheda di allenamento, in due vesti che condividono la stessa forma:
//
// - **modello** (`is_template`): sta nel catalogo, non è di nessuno, si riusa;
// - **assegnata**: è di un socio, e nasce da zero o dalla copia di un modello.
//
// Sono una tabella sola perché il contenuto è identico — cambia solo a chi appartiene.
// Con due tabelle ogni riga di codice che legge, disegna o valida una scheda andrebbe
// scritta due volte, e assegnare un modello diventerebbe una conversione fra due formati
// invece di una copia.
export const exercisePlans = pgTable('exercise_plans', {
	id: uuid('id').defaultRandom().primaryKey(),
	// Il discriminante è una colonna sua e non "member_id è nullo" perché l'API generica
	// filtra per uguaglianza e non sa esprimere IS NULL: senza, il catalogo dei modelli
	// non sarebbe interrogabile.
	isTemplate: boolean('is_template').notNull().default(false),
	// Nullo sui modelli: un modello non è di nessuno.
	memberId: uuid('member_id').references(() => members.id),
	memberName: varchar('member_name', { length: 255 }),
	name: varchar('name', { length: 255 }).notNull(),
	notes: text('notes'),
	// Array ordinato di **routine**, cioè di giornate di allenamento. È la routine che il
	// socio avvia — "Giorno 1 — Spinta" — non la scheda intera: una scheda è il programma
	// di una settimana o di un mese, e non si esegue tutta in una volta.
	//
	//   routine  = { nome, note, esercizi: [ … ] }
	//   esercizio = { exercise_id, exercise_name, muscle_group, recupero_secondi, note,
	//                 serie: [{ reps, rpe }, …] }
	//
	// jsonb e non tre tabelle figlie: una scheda si legge e si riscrive sempre intera, e
	// l'endpoint generico /api/entities non sa fare scritture annidate né transazioni.
	// Così il salvataggio resta una riga sola — o passa tutto o non passa niente — e
	// l'ordine di routine, esercizi e serie è quello degli array, senza colonne di
	// posizione da tenere allineate.
	//
	// Nome ed etichetta del gruppo sono copiati accanto all'id: una scheda già consegnata
	// deve restare leggibile com'era anche se l'esercizio viene poi rinominato o tolto dal
	// catalogo.
	routines: jsonb('routines').notNull().default([]),
	assignedDate: date('assigned_date'),
	// Da quale modello è stata copiata, quando lo è stata. Senza vincolo di chiave esterna
	// di proposito: è un'informazione storica, e un modello dismesso deve poter essere
	// eliminato senza trascinarsi dietro le schede già in mano ai soci.
	templateOriginId: uuid('template_origin_id'),
});

// Un allenamento vero: la routine che il socio ha avviato, quando l'ha iniziata e quando
// l'ha chiusa. È la riga che tiene insieme le serie eseguite — senza, un allenamento
// sarebbe solo un mucchio di serie sparse con la stessa data, e "quanto è durato" o
// "quante ne ho fatte oggi" non sarebbero domande a cui rispondere.
export const workoutSessions = pgTable('workout_sessions', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	// La scheda può essere modificata o eliminata dopo: la sessione si tiene nome della
	// scheda e della routine copiati accanto, così lo storico resta leggibile comunque.
	planId: uuid('plan_id').references(() => exercisePlans.id),
	planName: varchar('plan_name', { length: 255 }),
	routineIndex: integer('routine_index'),
	routineName: varchar('routine_name', { length: 255 }),
	iniziataAlle: timestamp('iniziata_alle').notNull().defaultNow(),
	// Nulla finché l'allenamento è in corso: è così che il portale ritrova una sessione
	// lasciata aperta quando il telefono si blocca a metà panca.
	terminataAlle: timestamp('terminata_alle'),
	note: text('note'),
});

// Una serie eseguita. La tabella esisteva già come "un esercizio registrato a fine
// allenamento"; ora ogni riga è una serie sola, spuntata mentre la si fa.
export const workoutLogs = pgTable('workout_logs', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	planId: uuid('plan_id').references(() => exercisePlans.id),
	planName: varchar('plan_name', { length: 255 }),
	// Nulla sulle righe registrate prima che esistessero le sessioni: restano nello
	// storico come sono, senza un allenamento a cui appartenere.
	sessionId: uuid('session_id').references(() => workoutSessions.id),
	// Posizione nella routine: serve a riaprire una sessione interrotta e ritrovare le
	// spunte al punto giusto, anche quando lo stesso esercizio compare due volte.
	exerciseIndex: integer('exercise_index'),
	setIndex: integer('set_index'),
	exerciseName: varchar('exercise_name', { length: 255 }),
	muscleGroup: varchar('muscle_group', { length: 32 }),
	pesoUsato: numeric('peso_usato', { precision: 8, scale: 2 }),
	repsFatte: integer('reps_fatte'),
	rpePercepito: numeric('rpe_percepito', { precision: 3, scale: 1 }),
	data: date('data').notNull(),
	note: text('note'),
});
