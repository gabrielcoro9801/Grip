// Regole per-entità applicate dall'endpoint generico: campi che non devono mai
// uscire dall'API, e trasformazioni da applicare in scrittura.
import bcrypt from 'bcryptjs';
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
