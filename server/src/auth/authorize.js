// Controllo dei permessi lato server.
//
// Finora la matrice ruolo → modulo esisteva solo nell'interfaccia: nascondeva le voci di
// menu, ma non impediva a nessuno di chiamare direttamente l'API. Qui viene applicata
// dove conta davvero, usando la stessa matrice condivisa — così non può divergere da
// quello che l'utente vede.
import { canAccess } from '../../../shared/permissions.js';

/**
 * Quale modulo governa la scrittura di ogni entità.
 *
 * **Ogni entità del registro deve comparire qui.** Prima chi mancava era scrivibile da
 * qualunque utente autenticato: la matrice diceva che un istruttore vede le anagrafiche e
 * non le tocca, ma un `PUT /api/entities/Member/<id>` passava lo stesso, e il limite
 * esisteva solo come pulsante nascosto. Peggio ancora per il registro delle azioni, che
 * nessun ruolo può modificare secondo la matrice e che invece chiunque poteva cancellare —
 * cioè la persona che il registro serve a incolpare poteva ripulirlo.
 *
 * Le righe che rimandavano ai moduli della contabilità sono sparite con quei moduli: erano
 * rimaste a puntare a entità che non esistono più e a permessi che nessun ruolo può avere.
 */
const ENTITY_MODULES = {
	// Anagrafiche dei soci e i loro documenti.
	Member: 'crm_members',
	Subscription: 'crm_members',
	Plan: 'crm_members',
	QRAccesso: 'crm_members',
	MemberDocument: 'crm_documents',

	// Corsi, calendario e prenotazioni.
	Course: 'calendar',
	Category: 'calendar',
	Instructor: 'calendar',
	Event: 'calendar',
	Session: 'calendar',
	Room: 'calendar',
	Booking: 'calendar',
	Collaboratore: 'calendar',

	// Catalogo esercizi e schede di allenamento. La matrice dice già che la reception le
	// vede e non le tocca ("crm_plans": ["view"]): finché mancavano da qui, quel limite
	// valeva solo per i pulsanti nascosti, e la stessa richiesta fatta a mano passava.
	Exercise: 'crm_plans',
	ExercisePlan: 'crm_plans',

	// L'intestazione dell'ente: nome, logo, recapiti. Si tocca da Admin & Utenti, che è
	// dove sta chi amministra l'installazione.
	Organization: 'admin_users',
};

/**
 * Il registro delle azioni si scrive soltanto aggiungendo righe.
 *
 * La matrice dà `audit_log: ["view"]` perfino all'amministratore, ma l'endpoint generico
 * lasciava cancellare: un registro che chi ci è dentro può ripulire non è un registro.
 * Le righe nuove le scrive l'applicazione mentre si lavora, quindi la creazione resta.
 */
const SOLO_AGGIUNTA = new Set(['AuditLog']);

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

/**
 * Se un ruolo dello staff può scrivere un'entità.
 *
 * `metodo` serve solo dove creare e cancellare non sono la stessa cosa — il registro delle
 * azioni, che si allunga e non si accorcia.
 */
export function canWriteEntity(role, entityName, metodo = 'POST') {
	if (role === 'member') return false;
	if (SOLA_LETTURA.has(entityName)) return false;
	if (SOLO_IL_PROPRIETARIO.has(entityName)) return false;
	if (SOLO_AGGIUNTA.has(entityName)) return metodo === 'POST';
	if (ADMIN_ONLY_WRITE.has(entityName)) return role === 'admin';

	const modulo = ENTITY_MODULES[entityName];
	// Un'entità che nessuno ha assegnato a un modulo non è scrivibile da nessuno: fino a
	// ieri era il contrario, e ogni tabella dimenticata restava aperta a tutto lo staff.
	// Meglio un flusso che si blocca e si nota subito, che un permesso che non c'è mai
	// stato e di cui nessuno si accorge.
	if (!modulo) return false;
	return canAccess(role, modulo, 'edit');
}

/**
 * Se per un'entità qualcuno ha preso una decisione, qualunque essa sia.
 *
 * Non dice che è scrivibile: dice che non è stata dimenticata. Da quando il valore
 * predefinito è "non scrivibile", un'entità nuova che nessuno assegna smette di funzionare
 * in silenzio, e questa funzione è ciò che permette a un test di accorgersene invece di
 * scoprirlo da un 403 in produzione.
 */
export function haRegolaDiScrittura(entityName) {
	return (
		entityName in ENTITY_MODULES ||
		SOLO_IL_PROPRIETARIO.has(entityName) ||
		ADMIN_ONLY_WRITE.has(entityName) ||
		SOLA_LETTURA.has(entityName) ||
		SOLO_AGGIUNTA.has(entityName)
	);
}

// Le registrazioni scritte a mano scavalcano le causali e possono movimentare qualsiasi
// conto: sono lo strumento con cui si può alterare la contabilità senza lasciare traccia
// del perché. Restano possibili, ma solo all'amministratore.
export function canCreateManualEntry(role) {
	return role === 'admin';
}
