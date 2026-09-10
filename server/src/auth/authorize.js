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
	// Il registro: scriverci senza il permesso "finance" era possibile fino ad ora solo
	// perché mancavano da questa mappa — non perché fosse una scelta.
	JournalEntry: 'finance',
	JournalLine: 'finance',
	// Catalogo esercizi e schede di allenamento. La matrice dice già che la reception le
	// vede e non le tocca ("crm_plans": ["view"]): finché mancavano da qui, quel limite
	// valeva solo per i pulsanti nascosti, e la stessa richiesta fatta a mano passava.
	Exercise: 'crm_plans',
	ExercisePlan: 'crm_plans',
};

// Gli allenamenti svolti: lo staff li **legge** per seguire i soci, ma non li scrive.
//
// Sono il diario di quello che una persona ha fatto in sala, e correggerlo dall'esterno
// significherebbe cambiare il suo storico senza che se ne accorga. Chi si allena sistema i
// propri errori — cancellare una seduta creata per sbaglio, correggere un carico battuto
// male — e l'istruttore, se vede un numero strano, glielo fa notare.
//
// Il socio non passa da qui: le proprie sessioni e le proprie serie le scrive comunque,
// attraverso memberPuoScrivere.
const SOLO_IL_PROPRIETARIO = new Set(['WorkoutSession', 'WorkoutLog']);

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
	if (SOLO_IL_PROPRIETARIO.has(entityName)) return false;
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
