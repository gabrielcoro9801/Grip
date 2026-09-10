// Mappa nome entità (PascalCase, come usato da api.entities.X nel
// frontend) -> tabella Drizzle corrispondente. Questa è la chiave che rende possibile
// un endpoint generico /api/entities/:name invece di un endpoint dedicato per ciascuna.
import * as schema from '../db/schema/index.js';

export const entityRegistry = {
	Member: schema.members,
	Subscription: schema.subscriptions,
	Plan: schema.plans,
	MemberDocument: schema.memberDocuments,
	QRAccesso: schema.qrAccessi,
	Course: schema.courses,
	Category: schema.categories,
	Instructor: schema.instructors,
	Event: schema.events,
	Session: schema.sessions,
	Room: schema.rooms,
	Booking: schema.bookings,
	Collaboratore: schema.collaboratori,
	StaffAccount: schema.staffAccounts,
	Exercise: schema.exercises,
	ExercisePlan: schema.exercisePlans,
	WorkoutSession: schema.workoutSessions,
	WorkoutLog: schema.workoutLogs,
	Organization: schema.organizations,
	AuditLog: schema.auditLogs,
};

export const ENTITY_NAMES = Object.keys(entityRegistry);
