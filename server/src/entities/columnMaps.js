// Il frontend usa nomi campo snake_case (es. "member_id",
// "created_date") mentre le colonne Drizzle sono esposte con chiave JS camelCase
// (es. memberId). Questo modulo costruisce, per ogni tabella, la corrispondenza
// bidirezionale necessaria a tradurre query string/body in ingresso verso l'API
// Drizzle corretta, mantenendo l'endpoint generico davvero generico.
import { getTableColumns } from 'drizzle-orm';

const cache = new Map();

export function getColumnMaps(table) {
	if (cache.has(table)) return cache.get(table);

	const columns = getTableColumns(table);
	const dbNameToColumn = {};
	const dbNameToJsKey = {};
	for (const [jsKey, column] of Object.entries(columns)) {
		dbNameToColumn[column.name] = column;
		dbNameToJsKey[column.name] = jsKey;
	}

	const result = { columns, dbNameToColumn, dbNameToJsKey };
	cache.set(table, result);
	return result;
}

const TEXT_LIKE = /^(varchar|text|char)/i;
const TIMESTAMP_LIKE = /^timestamp/i;

// Adatta un valore in arrivo dal client al tipo reale della colonna. Il datastore
// precedente non aveva schema e accettava qualsiasi cosa; qui le colonne sono tipizzate,
// quindi due abitudini diffuse nel frontend vanno tradotte:
//
// - la stringa vuota dei campi lasciati in bianco, che per date, numeri, booleani e uuid
//   significa "non valorizzato", cioè NULL (nelle colonne testuali invece è un valore
//   legittimo e va conservata);
// - le date inviate come stringa ISO (`new Date().toISOString()`), che il driver si
//   aspetta invece come oggetto Date.
function normalizeValue(column, value) {
	const sqlType = column.getSQLType();

	if (value === '') {
		return TEXT_LIKE.test(sqlType) ? value : null;
	}
	if (typeof value === 'string' && TIMESTAMP_LIKE.test(sqlType)) {
		const parsed = new Date(value);
		// Una stringa non interpretabile come data viene lasciata passare così com'è:
		// meglio l'errore esplicito del database che una data inventata.
		return Number.isNaN(parsed.getTime()) ? value : parsed;
	}
	return value;
}

// Traduce un oggetto con chiavi snake_case (dal body della request) in un oggetto
// con chiavi camelCase (quello che si aspetta Drizzle in .values()/.set()).
// I campi sconosciuti vengono scartati silenziosamente: il frontend a volte invia
// proprietà accessorie che non corrispondono a colonne, e non devono far fallire la scrittura.
export function translateToJs(table, snakeCaseObj) {
	const { dbNameToJsKey, dbNameToColumn } = getColumnMaps(table);
	const out = {};
	for (const [key, value] of Object.entries(snakeCaseObj ?? {})) {
		const jsKey = dbNameToJsKey[key];
		if (jsKey) out[jsKey] = normalizeValue(dbNameToColumn[key], value);
	}
	return out;
}

// Direzione inversa: le righe che escono da Drizzle hanno chiavi camelCase (es.
// fullName), ma tutto il frontend legge/scrive snake_case (es. full_name).
// Senza questa traduzione il client non sarebbe compatibile con il codice esistente:
// ogni riga restituita dall'API va riserializzata in snake_case.
export function translateToSnakeCase(table, row) {
	if (!row) return row;
	const { columns } = getColumnMaps(table);
	const out = {};
	for (const [jsKey, column] of Object.entries(columns)) {
		if (jsKey in row) out[column.name] = row[jsKey];
	}
	return out;
}

export function translateManyToSnakeCase(table, rows) {
	return rows.map((row) => translateToSnakeCase(table, row));
}
