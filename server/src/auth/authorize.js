// Controllo dei permessi lato server.
//
// Finora la matrice ruolo → modulo esisteva solo nell'interfaccia: nascondeva le voci di
// menu, ma non impediva a nessuno di chiamare direttamente l'API. Qui viene applicata
// dove conta davvero, usando la stessa matrice condivisa — così non può divergere da
// quello che l'utente vede.
import { canAccess } from '../../../shared/permissions.js';

// Entità governate da un modulo specifico. Quelle non elencate restano accessibili a
// qualunque utente autenticato dello staff: l'elenco viene stretto man mano che ogni
// area viene verificata, invece di indovinare tutto in una volta e rischiare di
// bloccare flussi che funzionano.
const ENTITY_MODULES = {
	// Configurazione contabile: tocca il modo in cui tutte le scritture vengono generate.
	ChartOfAccount: 'finance',
	CausaleOperativa: 'finance',
	Loan: 'finance',
	LoanInstallment: 'finance',
	// Anagrafiche e documenti fiscali dell'ente.
	FiscalProfileSnapshot: 'fiscal_profile',
	FiscalYearData: 'fiscal_profile',
	ReceiptTemplate: 'receipt_template',
	Organization: 'fiscal_profile',
	// Fornitori e ciclo acquisti.
	AccountingSupplier: 'suppliers',
	PurchaseOrder: 'acquisti',
	Bank: 'finance',
	Payslip: 'personale',
	PayrollRun: 'personale',
};

// Entità che solo un amministratore può modificare, a prescindere dalla matrice:
// da qui si creano gli account e si assegnano i ruoli, cioè si decide chi può fare cosa.
const ADMIN_ONLY_WRITE = new Set(['StaffAccount']);

// Aliquote e soglie di legge: non sono configurazione dell'ente e non si modificano
// dall'applicazione. Cambiano quando cambia una norma, e allora si aggiunge una riga con
// una migrazione — così resta traccia di cosa valeva prima.
const SOLA_LETTURA = new Set(['ParametroFiscale']);

export function canWriteEntity(role, entityName) {
	if (role === 'member') return false;
	if (SOLA_LETTURA.has(entityName)) return false;
	if (ADMIN_ONLY_WRITE.has(entityName)) return role === 'admin';

	const modulo = ENTITY_MODULES[entityName];
	if (!modulo) return true;
	return canAccess(role, modulo, 'edit');
}

// Le registrazioni scritte a mano scavalcano le causali e possono movimentare qualsiasi
// conto: sono lo strumento con cui si può alterare la contabilità senza lasciare traccia
// del perché. Restano possibili, ma solo all'amministratore.
export function canCreateManualEntry(role) {
	return role === 'admin';
}
