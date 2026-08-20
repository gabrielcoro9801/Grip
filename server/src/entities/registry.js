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
	PurchaseOrder: schema.purchaseOrders,
	Bank: schema.banks,
	ExerciseClosure: schema.exerciseClosures,
	JournalAttachment: schema.journalAttachments,
	Payslip: schema.payslips,
	PayrollRun: schema.payrollRuns,
	FiscalProfileSnapshot: schema.fiscalProfileSnapshots,
	FiscalYearData: schema.fiscalYearData,
	// Aliquote e soglie di legge, con la data da cui valgono. Sola lettura di fatto: le
	// modifiche passano da una migrazione, perché sono legge e non configurazione dell'ente.
	ParametroFiscale: schema.parametriFiscali,
	ReceiptTemplate: schema.receiptTemplates,
	Receipt: schema.receipts,
	Invoice: schema.invoices,
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
