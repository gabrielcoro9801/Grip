// Regole per-entità applicate dall'endpoint generico: campi che non devono mai
// uscire dall'API, e trasformazioni da applicare in scrittura.
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { firmaUrl, togliFirma } from '../lib/urlFirmati.js';
import { db } from '../db/client.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { plans } from '../db/schema/index.js';
import {
	sessoValido, normalizzaCodiceFiscale, codiceFiscaleValido, motivoDocumentoNonValido, tipoDocumentoValido,
} from '../../../shared/anagrafica.js';
import {
	unitaDurataValida, statoTipoValido, motivoCambioStatoNonValido, motivoNonVendibile, dataFineAbbonamento,
	oggiIso, NOTE_MASSIMO,
} from '../../../shared/abbonamenti.js';

// Campi rimossi da ogni risposta, per entità.
const HIDDEN_FIELDS = {
	StaffAccount: ['password_hash'],
};

// Entità che non possono essere create, modificate o cancellate dall'endpoint generico,
// con il motivo mostrato a chi ci prova.
export const CREATE_FORBIDDEN = {};
export const UPDATE_FORBIDDEN = {};
export const DELETE_FORBIDDEN = {
	// Le iscrizioni vendute puntano al tipo: cancellarlo lascerebbe iscrizioni senza origine.
	Plan: "Un abbonamento del catalogo non si elimina: si sospende o si annulla.",
};

/**
 * Motivo per cui una singola riga non è modificabile, se ce n'è uno.
 *
 * @param corpo quello che la modifica vorrebbe scrivere: alcune regole dipendono da com'è la
 *              riga oggi e da come diventerebbe (un tipo annullato non torna attivo).
 */
export async function mutationBlockedReason(entityName, _table, id, operazione, corpo) {
	if (entityName === 'Plan' && operazione === 'update' && corpo && presente(corpo, 'stato')) {
		const [tipo] = await db.select({ stato: plans.stato }).from(plans).where(eq(plans.id, id)).limit(1);
		if (tipo) return motivoCambioStatoNonValido(tipo.stato, corpo.stato);
	}
	return null;
}

/**
 * Un rifiuto dalla trasformazione in scrittura.
 *
 * Porta il codice 400, che il gestore degli errori (routes/errorHandler.js) rimanda al client
 * col messaggio: chi compila il modulo deve leggere cosa correggere, non "errore interno".
 */
export function rifiuta(messaggio) {
	const errore = new Error(messaggio);
	errore.statusCode = 400;
	return errore;
}

const presente = (corpo, campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
const vuoto = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Le regole dell'anagrafica di un socio, valide per ogni strada da cui ne nasce uno: il modulo
 * dei soci e la trasformazione di un lead (routes/lead.js).
 *
 * In creazione tutto deve esserci. In modifica si controlla solo quello che arriva: un socio
 * registrato prima che il codice fiscale fosse obbligatorio resta modificabile nel resto, ma
 * il codice non si può svuotare né scrivere sbagliato.
 */
export function anagraficaSocio(corpo, { creazione }) {
	const { full_name: _calcolato, ...rest } = corpo ?? {};

	for (const campo of ['nome', 'cognome']) {
		if (presente(rest, campo)) rest[campo] = String(rest[campo] ?? '').trim();
		if ((creazione || presente(rest, campo)) && vuoto(rest[campo])) {
			throw rifiuta(campo === 'nome' ? 'Il nome è obbligatorio.' : 'Il cognome è obbligatorio.');
		}
	}
	if ((creazione || presente(rest, 'sesso')) && !sessoValido(rest.sesso)) {
		throw rifiuta('Indica il sesso: M, F o Altro.');
	}
	if (creazione || presente(rest, 'codice_fiscale')) {
		if (vuoto(rest.codice_fiscale)) throw rifiuta('Il codice fiscale è obbligatorio.');
		rest.codice_fiscale = normalizzaCodiceFiscale(rest.codice_fiscale);
		if (!codiceFiscaleValido(rest.codice_fiscale)) throw rifiuta('Il codice fiscale non è valido: controlla di averlo scritto bene.');
	}
	if (!creazione) rest.updated_date = new Date().toISOString();
	return rest;
}

// Trasformazioni in scrittura: il frontend continua a inviare `password` in chiaro
// per compatibilità con i form esistenti, ma qui viene hashata in password_hash —
// la password in chiaro non tocca mai il database.
const WRITE_TRANSFORMS = {
	async StaffAccount(body) {
		const { password, password_hash: _ignored, ...rest } = body ?? {};
		if (password) {
			rest.password_hash = await bcrypt.hash(password, 10);
		}
		return rest;
	},

	// Il codice socio veniva calcolato nel browser sul massimo fra i soci *già caricati*
	// in pagina: bastavano due iscrizioni contemporanee, o una lista non aggiornata, per
	// assegnare lo stesso codice a due persone. Ora arriva dal contatore.
	//
	// `full_name` si scarta: è calcolato dal database da nome e cognome, e scriverlo farebbe
	// fallire l'inserimento.
	async Member(body, { creazione }) {
		const rest = anagraficaSocio(body, { creazione });
		// Il codice è la chiave del socio: lo decide sempre il contatore, anche se il modulo ne
		// manda uno, e non si riscrive in modifica.
		if (creazione) rest.codice_socio = await assegnaCodiceSocio(db);
		else delete rest.codice_socio;
		return rest;
	},

	// Un tipo di abbonamento nasce completo e attivo, e poi si tocca solo nello stato: nome,
	// prezzo e durata sono quelli con cui le iscrizioni sono state vendute.
	async Plan(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (!creazione) {
			const campi = Object.keys(rest).filter((k) => !['id', 'stato', 'created_date', 'updated_date'].includes(k));
			if (campi.length) throw rifiuta("Di un abbonamento del catalogo si cambia solo lo stato.");
			if (!statoTipoValido(rest.stato)) throw rifiuta('Stato non valido: attivo, sospeso o annullato.');
			return { stato: rest.stato, updated_date: new Date().toISOString() };
		}
		rest.name = String(rest.name ?? '').trim();
		if (!rest.name) throw rifiuta("Il nome dell'abbonamento è obbligatorio.");
		const prezzo = Number(rest.price);
		if (vuoto(rest.price) || !Number.isFinite(prezzo) || prezzo < 0) throw rifiuta('Il prezzo non è valido.');
		const durata = Number(rest.durata_valore);
		if (!Number.isInteger(durata) || durata < 1) throw rifiuta('La durata deve essere un numero intero maggiore di zero.');
		if (!unitaDurataValida(rest.durata_unita)) throw rifiuta('La durata va in giorni, mesi o anni.');
		rest.durata_valore = durata;
		if (vuoto(rest.vendibile_fino_al)) rest.vendibile_fino_al = null;
		else if (!/^\d{4}-\d{2}-\d{2}$/.test(rest.vendibile_fino_al)) throw rifiuta('La data massima di vendita non è valida.');
		else if (rest.vendibile_fino_al < oggiIso()) throw rifiuta('La data massima di vendita è già passata.');
		if (vuoto(rest.description)) rest.description = null;
		else if (String(rest.description).length > NOTE_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_MASSIMO} caratteri.`);
		rest.stato = 'attivo';
		return rest;
	},

	// Un'iscrizione si vende solo da un tipo vendibile, e la scadenza la calcola il server dalla
	// durata del tipo: mesi di calendario, non giorni contati nel browser.
	async Subscription(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (!creazione || !rest.plan_id) return rest;
		const [tipo] = await db.select().from(plans).where(eq(plans.id, rest.plan_id)).limit(1);
		const motivo = motivoNonVendibile(tipo && { name: tipo.name, stato: tipo.stato, vendibile_fino_al: tipo.vendibileFinoAl });
		if (motivo) throw rifiuta(motivo);
		if (vuoto(rest.start_date)) rest.start_date = oggiIso();
		rest.end_date = dataFineAbbonamento(rest.start_date, tipo.durataValore, tipo.durataUnita);
		if (!rest.end_date) throw rifiuta("La data di inizio non è valida.");
		rest.plan_name = tipo.name;
		if (vuoto(rest.price_paid)) rest.price_paid = tipo.price;
		return rest;
	},

	// Tipo fra i tre ammessi, titolo per gli "altri", scadenza per quelli che scadono. In modifica
	// si controlla solo il tipo, se cambia: oggi i documenti si caricano e non si correggono.
	async MemberDocument(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (creazione) {
			const motivo = motivoDocumentoNonValido(rest);
			if (motivo) throw rifiuta(motivo);
		} else if (presente(rest, 'document_type') && !tipoDocumentoValido(rest.document_type)) {
			throw rifiuta('Tipo di documento non valido.');
		}
		return rest;
	},

	// Un contatto: i campi obbligatori li difende già il database; qui si ripuliscono i vuoti
	// che i moduli mandano come stringa, perché un'email "" non è un'email.
	async Lead(body) {
		const rest = { ...(body ?? {}) };
		for (const campo of ['nome', 'cognome']) {
			if (presente(rest, campo)) rest[campo] = String(rest[campo] ?? '').trim();
		}
		for (const campo of ['telefono', 'email']) {
			if (presente(rest, campo) && vuoto(rest[campo])) rest[campo] = null;
		}
		if (presente(rest, 'sesso') && !sessoValido(rest.sesso)) throw rifiuta('Indica il sesso: M, F o Altro.');
		if ((presente(rest, 'nome') && !rest.nome) || (presente(rest, 'cognome') && !rest.cognome)) {
			throw rifiuta('Nome e cognome sono obbligatori.');
		}
		rest.updated_date = new Date().toISOString();
		return rest;
	},
};

/** @param opzioni { creazione: boolean } — alcune regole valgono solo quando la riga nasce. */
export async function applyWriteTransform(entityName, body, { creazione = true } = {}) {
	const transform = WRITE_TRANSFORMS[entityName];
	return transform ? transform(body, { creazione }) : body;
}

export function stripHiddenFields(entityName, row) {
	const hidden = HIDDEN_FIELDS[entityName];
	if (!hidden || !row) return row;
	const out = { ...row };
	for (const field of hidden) delete out[field];
	return out;
}

export function stripHiddenFieldsMany(entityName, rows) {
	const hidden = HIDDEN_FIELDS[entityName];
	if (!hidden) return rows;
	return rows.map((row) => stripHiddenFields(entityName, row));
}

/**
 * Gli indirizzi dei file caricati escono firmati, e rientrano senza firma.
 *
 * `/uploads/*` non è più aperto a chiunque (vedi `lib/urlFirmati.js`): per aprire un file
 * serve una firma nell'indirizzo. Applicarla qui — nel punto unico da cui passano tutte le
 * letture delle entità — vuol dire che nessuna schermata deve saperlo: continua a mettere
 * `esercizio.image_url` dentro un `<img src>` come ha sempre fatto.
 *
 * Il verso opposto conta quanto questo. Le schermate del gestionale rileggono l'indirizzo
 * di un'immagine, lo mettono in un campo del modulo e lo risalvano com'è: senza toglierla,
 * nel database finirebbe una firma, cioè un'immagine che smette di vedersi qualche ora dopo
 * senza che nessuno abbia toccato niente.
 */
const CAMPO_E_UN_FILE = /_url$/;

function mappaCampiFile(riga, come) {
	if (!riga || typeof riga !== 'object') return riga;
	let out = riga;
	for (const [campo, valore] of Object.entries(riga)) {
		if (!CAMPO_E_UN_FILE.test(campo) || typeof valore !== 'string') continue;
		const nuovo = come(valore);
		if (nuovo === valore) continue;
		if (out === riga) out = { ...riga };
		out[campo] = nuovo;
	}
	return out;
}

export function firmaFileInLettura(riga) {
	return mappaCampiFile(riga, firmaUrl);
}

export function firmaFileInLetturaMolte(righe) {
	return Array.isArray(righe) ? righe.map(firmaFileInLettura) : righe;
}

export function togliFirmaInScrittura(body) {
	return mappaCampiFile(body, togliFirma);
}
