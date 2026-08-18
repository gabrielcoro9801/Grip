// Mappa nome entità (PascalCase, come usato da api.entities.X nel
// frontend) -> tabella Drizzle corrispondente. Questa è la chiave che rende possibile
// un endpoint generico /api/entities/:name invece di 39 endpoint dedicati.
import * as schema from '../db/schema/index.js';

export const entityRegistry = {
	Member: schema.members,
	Client: schema.clients,
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
	ChartOfAccount: schema.chartOfAccounts,
	CausaleOperativa: schema.causaliOperative,
	JournalEntry: schema.journalEntries,
	JournalLine: schema.journalLines,
	Loan: schema.loans,
	LoanInstallment: schema.loanInstallments,
	AccountingSupplier: schema.accountingSuppliers,
	FixedAsset: schema.fixedAssets,
	Revenue: schema.revenues,
	Expense: schema.expenses,
	FiscalProfileSnapshot: schema.fiscalProfileSnapshots,
	FiscalYearData: schema.fiscalYearData,
	ReceiptTemplate: schema.receiptTemplates,
	Receipt: schema.receipts,
	Collaboratore: schema.collaboratori,
	StaffAccount: schema.staffAccounts,
	Timbratura: schema.timbrature,
	Turno: schema.turni,
	RichiestaFeriePermesso: schema.richiesteFeriePermesso,
	SedutaPT: schema.sedutePt,
	LiquidazionePT: schema.liquidazioniPt,
	Exercise: schema.exercises,
	ExercisePlan: schema.exercisePlans,
	WorkoutLog: schema.workoutLogs,
	Organization: schema.organizations,
	AuditLog: schema.auditLogs,
};

export const ENTITY_NAMES = Object.keys(entityRegistry);
