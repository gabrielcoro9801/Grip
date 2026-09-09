// Endpoint REST generico che copre list/filter/get/create/update/delete/bulkCreate
// per tutte le 39 entità, con la stessa semantica del vecchio datastore.
// Un solo set di route invece di 39 endpoint dedicati.
import { eq, and, asc, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { entityRegistry } from '../entities/registry.js';
import { getColumnMaps, translateToJs, translateToSnakeCase, translateManyToSnakeCase } from '../entities/columnMaps.js';
import {
	applyWriteTransform, stripHiddenFields, stripHiddenFieldsMany,
	CREATE_FORBIDDEN, UPDATE_FORBIDDEN, DELETE_FORBIDDEN, mutationBlockedReason,
} from '../entities/hooks.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { memberPuoLeggere, memberPuoScrivere, colonnaProprietario, nascondiCampiPerSocio, forzaProprietario } from '../auth/memberScope.js';
import { staffAccounts } from '../db/schema/index.js';
import { registerPgErrorHandler } from './errorHandler.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default async function entityRoutes(fastify) {
	registerPgErrorHandler(fastify);

	// Tutti i dati applicativi richiedono un utente autenticato: senza questo controllo
	// l'intero database (anagrafiche soci, contabilità, account) sarebbe leggibile e
	// scrivibile da chiunque raggiunga la porta del server.
	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) {
			return reply.code(401).send({ error: 'Non autenticato.' });
		}
		const { name } = request.params;
		if (name && !entityRegistry[name]) {
			return reply.code(404).send({ error: `Entità sconosciuta: ${name}` });
		}
		// Il ruolo viene applicato sulle modifiche: nascondere un pulsante non impedisce
		// di chiamare l'API, quindi il controllo dell'interfaccia da solo non protegge nulla.
		const scrittura = WRITE_METHODS.has(request.method);
		const consentito = user.ruolo === 'member'
			? memberPuoScrivere(name)
			: canWriteEntity(user.ruolo, name);
		if (name && scrittura && !consentito) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}

		// Un socio entra in un'area che deve mostrargli i propri dati: tutto il resto —
		// contabilità, account, cedolini, anagrafiche degli altri — non lo riguarda.
		if (user.ruolo === 'member' && name) {
			if (!memberPuoLeggere(name)) {
				return reply.code(403).send({ error: 'Non consentito.' });
			}
			// Il socio a cui l'account è collegato si legge dal database e non dal token:
			// così revocare il collegamento ha effetto subito.
			const [account] = await db
				.select({ memberId: staffAccounts.linkedMemberId })
				.from(staffAccounts)
				.where(eq(staffAccounts.id, user.sub))
				.limit(1);
			if (!account?.memberId) {
				return reply.code(403).send({ error: 'Account non collegato a un socio.' });
			}
			request.memberId = account.memberId;
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

		// Al socio si restituiscono solo le righe che lo riguardano: il filtro è imposto
		// qui, non chiesto al client, perché il client può sempre ometterlo.
		if (request.memberId) {
			const colonna = colonnaProprietario(entityName);
			if (colonna && dbNameToColumn[colonna]) {
				conditions.push(eq(dbNameToColumn[colonna], request.memberId));
			}
		}
		if (conditions.length) query = query.where(and(...conditions));

		if (_sort) {
			const isDesc = _sort.startsWith('-');
			const column = dbNameToColumn[isDesc ? _sort.slice(1) : _sort];
			if (column) query = query.orderBy(isDesc ? desc(column) : asc(column));
		}
		if (_limit) query = query.limit(parseInt(_limit, 10));

		const rows = await query;
		const risultato = stripHiddenFieldsMany(entityName, translateManyToSnakeCase(table, rows));
		return request.memberId ? nascondiCampiPerSocio(entityName, risultato) : risultato;
	});

	// GET /api/entities/:name/:id
	fastify.get('/api/entities/:name/:id', async (request, reply) => {
		const entityName = request.params.name;
		const table = entityRegistry[entityName];
		const { dbNameToColumn } = getColumnMaps(table);
		const [row] = await db.select().from(table).where(eq(dbNameToColumn.id, request.params.id)).limit(1);
		if (!row) return reply.code(404).send({ error: 'Non trovato' });

		// Chiedere un record per id non deve aggirare il filtro: senza questo controllo
		// basterebbe indovinare un identificativo per leggere la scheda di un altro socio.
		if (request.memberId) {
			const colonna = colonnaProprietario(entityName);
			if (colonna && String(row[getColumnMaps(table).dbNameToJsKey[colonna]]) !== String(request.memberId)) {
				return reply.code(404).send({ error: 'Non trovato' });
			}
		}

		const risultato = stripHiddenFields(entityName, translateToSnakeCase(table, row));
		return request.memberId ? nascondiCampiPerSocio(entityName, risultato) : risultato;
	});

	// POST /api/entities/:name
	fastify.post('/api/entities/:name', async (request, reply) => {
		const entityName = request.params.name;
		if (CREATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: CREATE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		let body = await applyWriteTransform(entityName, request.body);
		// Un socio crea solo record intestati a sé: l'appartenenza la impone il server,
		// altrimenti basterebbe cambiare un identificativo nella richiesta.
		if (request.memberId) body = forzaProprietario(entityName, body, request.memberId);
		const [row] = await db.insert(table).values(translateToJs(table, body)).returning();
		reply.code(201);
		return stripHiddenFields(entityName, translateToSnakeCase(table, row));
	});

	// POST /api/entities/:name/bulk  (bulkCreate)
	fastify.post('/api/entities/:name/bulk', async (request, reply) => {
		const entityName = request.params.name;
		if (CREATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: CREATE_FORBIDDEN[entityName] });
		}
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
		if (UPDATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: UPDATE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		const bloccato = await mutationBlockedReason(entityName, table, request.params.id, 'update');
		if (bloccato) return reply.code(400).send({ error: bloccato });
		const { dbNameToColumn } = getColumnMaps(table);
		const body = await applyWriteTransform(entityName, request.body);
		const data = translateToJs(table, body);
		const [row] = await db.update(table).set(data).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		return stripHiddenFields(entityName, translateToSnakeCase(table, row));
	});

	// DELETE /api/entities/:name/:id
	fastify.delete('/api/entities/:name/:id', async (request, reply) => {
		const entityName = request.params.name;
		if (DELETE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: DELETE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		const bloccato = await mutationBlockedReason(entityName, table, request.params.id, 'delete');
		if (bloccato) return reply.code(400).send({ error: bloccato });
		const { dbNameToColumn } = getColumnMaps(table);
		const [row] = await db.delete(table).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		return { success: true };
	});
}
