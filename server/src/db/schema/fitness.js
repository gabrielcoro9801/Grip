// Dominio fitness: Exercise, ExercisePlan, WorkoutLog.
import { pgTable, uuid, varchar, text, integer, numeric, date, jsonb } from 'drizzle-orm/pg-core';
import { members } from './crm.js';

export const exercises = pgTable('exercises', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	muscleGroup: varchar('muscle_group', { length: 32 }), // Chest|Back|Shoulders|Biceps|Triceps|Legs|Core|Full Body|Cardio
	defaultSets: integer('default_sets').default(3),
	defaultReps: varchar('default_reps', { length: 16 }).default('10'), // testo: può essere "10" o "8-12"
});

export const exercisePlans = pgTable('exercise_plans', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	memberName: varchar('member_name', { length: 255 }),
	name: varchar('name', { length: 255 }).notNull(),
	notes: text('notes'),
	// Array di { exercise_name, muscle_group, sets, reps, peso, rpe } — denormalizzato
	// per valore nel codice attuale (nessuna FK verso exercises.id osservata).
	exercises: jsonb('exercises').notNull().default([]),
	assignedDate: date('assigned_date'),
});

export const workoutLogs = pgTable('workout_logs', {
	id: uuid('id').defaultRandom().primaryKey(),
	memberId: uuid('member_id').notNull().references(() => members.id),
	planId: uuid('plan_id').references(() => exercisePlans.id),
	planName: varchar('plan_name', { length: 255 }),
	exerciseName: varchar('exercise_name', { length: 255 }),
	muscleGroup: varchar('muscle_group', { length: 32 }),
	pesoUsato: numeric('peso_usato', { precision: 8, scale: 2 }),
	repsFatte: integer('reps_fatte'),
	rpePercepito: integer('rpe_percepito'),
	data: date('data').notNull(),
	note: text('note'),
});
