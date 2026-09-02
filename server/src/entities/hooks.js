// Regole per-entità applicate dall'endpoint generico: campi che non devono mai
// uscire dall'API, e trasformazioni da applicare in scrittura.
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members } from '../db/schema/index.js';
import { nextNumber } from '../lib/numbering.js';

// Campi rimossi da ogni risposta, per entità.
const HIDDEN_FIELDS = {
	StaffAccount: ['password_hash'],
};

// Entità che non possono essere create dall'endpoint generico, con il motivo mostrato
// a chi ci prova. Una registrazione contabile deve nascere con le sue righe e con un
// numero di protocollo assegnato in transazione: creandola qui si otterrebbe una
// testata sola, cioè una registrazione che non quadra.
export const CREATE_FORBIDDEN = {
	JournalEntry: 'Le registrazioni contabili si creano con POST /api/journal-entries, che scrive testata e righe insieme.',
	JournalLine: 'Le righe contabili si creano insieme alla loro registrazione, con POST /api/journal-entries.',
};

// Una riga non si tocca mai da sola, né in modifica né in cancellazione: appartiene a una
// registrazione e ne altera l'equilibrio dare/avere se manomessa isolatamente. La correzione
// passa sempre dalla registrazione intera (vedi mutationBlockedReason, sotto).
export const UPDATE_FORBIDDEN = {
	JournalLine: 'Le righe contabili non si modificano da sole: per correggere una registrazione confermata si usa uno storno.',
};

export const DELETE_FORBIDDEN = {
	JournalLine: 'Le righe contabili non si cancellano da sole: per correggere una registrazione confermata si usa uno storno.',
};

// Le bozze restano modificabili e cancellabili come oggi: è l'unico percorso esistente per
// correggerle prima che diventino definitive. Una volta confermata, una registrazione è
// già stata usata per liquidità, scadenzario o dichiarazioni — modificarla in place
// lascerebbe un disallineamento invisibile con tutto ciò che l'ha già letta. Da qui in poi
// l'unico modo per rimediare a un errore è uno storno, che lascia traccia di entrambi i
// movimenti invece di far sparire quello sbagliato.
export async function mutationBlockedReason(entityName, table, id, azione) {
	if (entityName !== 'JournalEntry') return null;
	const [row] = await db.select({ stato: table.stato }).from(table).where(eq(table.id, id)).limit(1);
	if (row?.stato !== 'confermata') return null;
	return azione === 'delete'
		? 'Una registrazione confermata non si cancella: per correggerla si usa uno storno.'
		: 'Una registrazione confermata non si modifica: per correggerla si usa uno storno.';
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
