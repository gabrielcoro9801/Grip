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

// I form dell'interfaccia inviano stringa vuota per i campi opzionali lasciati in
// bianco. Un datastore senza schema la accettava; qui le colonne hanno tipi reali e
// Postgres rifiuta '' per date, numeri, booleani e uuid. Su quelle colonne la stringa
// vuota significa "non valorizzato", cioè NULL — solo per le colonne testuali va
// conservata com'è, perché lì '' è un valore legittimo e distinto da NULL.
const TEXT_LIKE = /^(varchar|text|char)/i;

function normalizeEmptyString(column, value) {
	if (value !== '') return value;
	return TEXT_LIKE.test(column.getSQLType()) ? value : null;
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
		if (jsKey) out[jsKey] = normalizeEmptyString(dbNameToColumn[key], value);
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
