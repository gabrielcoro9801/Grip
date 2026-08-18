// Endpoint REST generico che copre list/filter/get/create/update/delete/bulkCreate
// per tutte le 39 entità, con la stessa semantica del vecchio datastore.
// Un solo set di route invece di 39 endpoint dedicati.
import { eq, and, asc, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { entityRegistry } from '../entities/registry.js';
import { getColumnMaps, translateToJs, translateToSnakeCase, translateManyToSnakeCase } from '../entities/columnMaps.js';
import { applyWriteTransform, stripHiddenFields, stripHiddenFieldsMany } from '../entities/hooks.js';
import { getUserFromRequest } from '../auth/tokens.js';

// Traduce i codici errore Postgres più comuni in risposte 400 leggibili invece del
// generico 500 — un client (es. un form del frontend) deve poter distinguere un
// proprio errore di input da un guasto del server.
const PG_ERROR_MESSAGES = {
	23503: 'Riferimento a un record inesistente (foreign key non valida).',
	23505: 'Valore duplicato su un campo che deve essere univoco.',
	23502: 'Campo obbligatorio mancante.',
	23514: 'Valore non valido per un vincolo del campo (check constraint).',
};

export default async function entityRoutes(fastify) {
	fastify.setErrorHandler((error, request, reply) => {
		const message = PG_ERROR_MESSAGES[error.code];
		if (message) {
			reply.code(400).send({ error: message, detail: error.detail });
			return;
		}
		request.log.error(error);
		reply.code(500).send({ error: 'Errore interno del server' });
	});

	// Tutti i dati applicativi richiedono un utente autenticato: senza questo controllo
	// l'intero database (anagrafiche soci, contabilità, account) sarebbe leggibile e
	// scrivibile da chiunque raggiunga la porta del server.
	fastify.addHook('preHandler', async (request, reply) => {
		if (!getUserFromRequest(request)) {
			return reply.code(401).send({ error: 'Non autenticato.' });
		}
		const { name } = request.params;
		if (name && !entityRegistry[name]) {
			return reply.code(404).send({ error: `Entità sconosciuta: ${name}` });
		}
	});

	// LIST (con _sort/_limit) e FILTER (qualsiasi altro query param = uguaglianza):
	// GET /api/entities/:name?_sort=-created_date&_limit=200
	// GET /api/entities/:name?member_id=...
	fastify.get('/api/entities/:name', async (request) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const { dbNameToColumn } = getColumnMaps(table);
		const { _sort, _limit, ...filters } = request.query;

		let query = db.select().from(table);

		const conditions = Object.entries(filters)
			.map(([key, value]) => {
				const column = dbNameToColumn[key];
				if (!column) return null;
				// I query param arrivano sempre come stringhe: i booleani vanno riconvertiti
				// o Postgres rifiuta il confronto su colonne boolean (es. ?attivo=true).
				if (column.dataType === 'boolean') return eq(column, value === 'true');
				return eq(column, value);
			})
			.filter(Boolean);
		if (conditions.length) query = query.where(and(...conditions));

		if (_sort) {
			const isDesc = _sort.startsWith('-');
			const column = dbNameToColumn[isDesc ? _sort.slice(1) : _sort];
			if (column) query = query.orderBy(isDesc ? desc(column) : asc(column));
		}
		if (_limit) query = query.limit(parseInt(_limit, 10));

		const rows = await query;
		return stripHiddenFieldsMany(entityName, translateManyToSnakeCase(table, rows));
	});

	// GET /api/entities/:name/:id
	fastify.get('/api/entities/:name/:id', async (request, reply) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const { dbNameToColumn } = getColumnMaps(table);
		const [row] = await db.select().from(table).where(eq(dbNameToColumn.id, request.params.id)).limit(1);
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		return stripHiddenFields(entityName, translateToSnakeCase(table, row));
	});

	// POST /api/entities/:name
	fastify.post('/api/entities/:name', async (request, reply) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const body = await applyWriteTransform(entityName, request.body);
		const [row] = await db.insert(table).values(translateToJs(table, body)).returning();
		reply.code(201);
		return stripHiddenFields(entityName, translateToSnakeCase(table, row));
	});

	// POST /api/entities/:name/bulk  (bulkCreate)
	fastify.post('/api/entities/:name/bulk', async (request, reply) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const source = Array.isArray(request.body) ? request.body : [];
		const items = [];
		for (const item of source) {
			items.push(translateToJs(table, await applyWriteTransform(entityName, item)));
		}
		if (!items.length) return [];
		const rows = await db.insert(table).values(items).returning();
		reply.code(201);
		return stripHiddenFieldsMany(entityName, translateManyToSnakeCase(table, rows));
	});

	// PUT /api/entities/:name/:id
	fastify.put('/api/entities/:name/:id', async (request, reply) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const { dbNameToColumn } = getColumnMaps(table);
		const body = await applyWriteTransform(entityName, request.body);
		const data = translateToJs(table, body);
		const [row] = await db.update(table).set(data).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		return stripHiddenFields(entityName, translateToSnakeCase(table, row));
	});

	// DELETE /api/entities/:name/:id
	fastify.delete('/api/entities/:name/:id', async (request, reply) => {
		const table = entityRegistry[request.params.name];
		const { dbNameToColumn } = getColumnMaps(table);
		const [row] = await db.delete(table).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		return { success: true };
	});
}
