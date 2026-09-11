// Regole per-entità applicate dall'endpoint generico: campi che non devono mai
// uscire dall'API, e trasformazioni da applicare in scrittura.
import bcrypt from 'bcryptjs';
import { firmaUrl, togliFirma } from '../lib/urlFirmati.js';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members } from '../db/schema/index.js';
import { nextNumber } from '../lib/numbering.js';

// Campi rimossi da ogni risposta, per entità.
const HIDDEN_FIELDS = {
	StaffAccount: ['password_hash'],
};

// Entità che non possono essere create, modificate o cancellate dall'endpoint generico,
// con il motivo mostrato a chi ci prova.
export const CREATE_FORBIDDEN = {};
export const UPDATE_FORBIDDEN = {};
export const DELETE_FORBIDDEN = {};

/** Motivo per cui una singola riga non è modificabile, se ce n'è uno. */
export async function mutationBlockedReason() {
	return null;
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
	async Member(body) {
		const rest = { ...(body ?? {}) };
		if (!rest.codice_socio && rest.organization_id) {
			const numero = await nextNumber(
				db, rest.organization_id, 'codice_socio',
				sql`SELECT MAX(CAST(NULLIF(regexp_replace(codice_socio, '\\D', '', 'g'), '') AS INTEGER)) FROM ${members}`,
			);
			rest.codice_socio = String(numero).padStart(6, '0');
		}
		return rest;
	},
};

export async function applyWriteTransform(entityName, body) {
	const transform = WRITE_TRANSFORMS[entityName];
	return transform ? transform(body) : body;
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
