// Endpoint REST generico che copre list/filter/get/create/update/delete/bulkCreate
// per tutte le 39 entità, con la stessa semantica del vecchio datastore.
// Un solo set di route invece di 39 endpoint dedicati.
import { eq, and, asc, desc, gte, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { entityRegistry } from '../entities/registry.js';
import { getColumnMaps, translateToJs, translateToSnakeCase, translateManyToSnakeCase } from '../entities/columnMaps.js';
import {
	applyWriteTransform, stripHiddenFields, stripHiddenFieldsMany,
	firmaFileInLettura, firmaFileInLetturaMolte, togliFirmaInScrittura, verificaCampiFile,
	conCampiCalcolati, conCampiCalcolatiMolte, campiCalcolati, togliCampiDiSistema,
	CREATE_FORBIDDEN, UPDATE_FORBIDDEN, DELETE_FORBIDDEN, mutationBlockedReason,
} from '../entities/hooks.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity, canReadEntity } from '../auth/authorize.js';
import { memberPuoLeggere, memberPuoScrivere, colonnaProprietario, colonnaProprietarioScrittura, nascondiCampiPerSocio, forzaProprietario } from '../auth/memberScope.js';
import { socioDiAccount } from '../auth/socioCorrente.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { colonneFile, cancellaFileNonPiuUsati } from '../lib/fileCaricati.js';
import { promuoviFinoACapienza } from '../lib/prenotazioni.js';
import { conSaleBloccate } from '../lib/sale.js';
import { registra, tipoEntita, nomeLeggibile, descriviModifica } from '../lib/registro.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MASSIMO_RIGHE = 5000;
const MASSIMO_CREAZIONE_MULTIPLA = 500;

export default async function entityRoutes(fastify) {
	registerPgErrorHandler(fastify);

	// Tutti i dati applicativi richiedono un utente autenticato: senza questo controllo
	// l'intero database (anagrafiche soci, certificati, account) sarebbe leggibile e
	// scrivibile da chiunque raggiunga la porta del server.
	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) {
			return reply.code(401).send({ error: 'Non autenticato.' });
		}
		request.utente = user;
		const { name } = request.params;
		if (name && !entityRegistry[name]) {
			return reply.code(404).send({ error: `Entità sconosciuta: ${name}` });
		}
		// Il ruolo viene applicato sulle modifiche: nascondere un pulsante non impedisce
		// di chiamare l'API, quindi il controllo dell'interfaccia da solo non protegge nulla.
		const scrittura = WRITE_METHODS.has(request.method);
		const consentito = user.ruolo === 'member'
			? memberPuoScrivere(name)
			: canWriteEntity(user.ruolo, name, request.method);
		if (name && scrittura && !consentito) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		// E anche sulle letture: nascondere la voce di menu non impedisce di chiedere i
		// certificati medici o il registro delle azioni all'API.
		if (name && !scrittura && user.ruolo !== 'member' && !canReadEntity(user.ruolo, name)) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di leggere questi dati.' });
		}

		// Un socio entra in un'area che deve mostrargli i propri dati: tutto il resto —
		// account dello staff, registro, anagrafiche degli altri — non lo riguarda.
		if (user.ruolo === 'member' && name) {
			if (!memberPuoLeggere(name)) {
				return reply.code(403).send({ error: 'Non consentito.' });
			}
			// Il socio a cui l'account è collegato si legge dal database e non dal token:
			// così revocare il collegamento ha effetto subito.
			const memberId = await socioDiAccount(user.sub);
			if (!memberId) {
				return reply.code(403).send({ error: 'Account non collegato a un socio.' });
			}
			request.memberId = memberId;
		}
	});

	// LIST (con _sort/_limit) e FILTER (qualsiasi altro query param = uguaglianza; con il
	// suffisso __gte / __lte = da / fino a):
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
				// Intervalli: `?date__gte=2026-10-01&date__lte=2026-10-31`. Senza, l'unico modo di
				// chiedere "le lezioni da qui in avanti" era prenderne un numero fisso ordinato per
				// data, e il calendario teneva le 500 più lontane nel futuro invece del mese corrente.
				const intervallo = /^(.+)__(gte|lte)$/.exec(key);
				if (intervallo) {
					const colonna = dbNameToColumn[intervallo[1]];
					if (!colonna || campiCalcolati(entityName).includes(intervallo[1])) return null;
					return intervallo[2] === 'gte' ? gte(colonna, value) : lte(colonna, value);
				}
				const column = dbNameToColumn[key];
				if (!column || campiCalcolati(entityName).includes(key)) return null;
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
		// Un tetto sempre, anche quando il client non lo chiede: senza, una lista restituiva
		// l'intera tabella e `_limit=10000000` chiedeva di tutto. È alto apposta — le pagine
		// del gestionale leggono ancora elenchi interi (ARC-01) e troncarli in silenzio sarebbe
		// peggio — e se lo si raggiunge lo si scrive nei log, perché vuol dire che una pagina
		// va riscritta per chiedere meno.
		const richiesto = Number.parseInt(_limit, 10);
		const tetto = Number.isInteger(richiesto) && richiesto > 0 ? Math.min(richiesto, MASSIMO_RIGHE) : MASSIMO_RIGHE;
		query = query.limit(tetto);

		const rows = await query;
		if (rows.length >= MASSIMO_RIGHE) {
			request.log.warn({ entita: entityName, righe: rows.length }, 'lista troncata al tetto massimo');
		}
		let risultato =conCampiCalcolatiMolte(entityName, firmaFileInLetturaMolte(stripHiddenFieldsMany(entityName, translateManyToSnakeCase(table, rows))));
		// Un filtro su un campo calcolato va applicato al valore calcolato, non alla colonna:
		// `?status=expired` sulla colonna non troverebbe mai niente.
		for (const campo of campiCalcolati(entityName)) {
			if (filters[campo] !== undefined) risultato = risultato.filter((r) => String(r[campo]) === String(filters[campo]));
		}
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

		const risultato = conCampiCalcolati(entityName, firmaFileInLettura(stripHiddenFields(entityName, translateToSnakeCase(table, row))));
		return request.memberId ? nascondiCampiPerSocio(entityName, risultato) : risultato;
	});

	// POST /api/entities/:name
	fastify.post('/api/entities/:name', async (request, reply) => conSaleBloccate(await saleCoinvolte(request), async () => {
		const entityName = request.params.name;
		if (CREATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: CREATE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		const ricevuto = togliFirmaInScrittura(togliCampiDiSistema(request.body));
		verificaCampiFile(ricevuto);
		if (await riferimentoAltrui(request, entityName, ricevuto)) return reply.code(404).send({ error: 'Non trovato' });
		let body = await applyWriteTransform(entityName, ricevuto, { utente: request.utente });
		// Un socio crea solo record intestati a sé: l'appartenenza la impone il server,
		// altrimenti basterebbe cambiare un identificativo nella richiesta.
		if (request.memberId) body = forzaProprietario(entityName, body, request.memberId);
		const [row] = await db.insert(table).values(translateToJs(table, body)).returning();
		const creata = translateToSnakeCase(table, row);
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: tipoEntita(entityName), entitaNome: nomeLeggibile(creata), entitaId: row.id,
		}, request.log);
		reply.code(201);
		return conCampiCalcolati(entityName, firmaFileInLettura(stripHiddenFields(entityName, creata)));
	}));

	// POST /api/entities/:name/bulk  (bulkCreate)
	fastify.post('/api/entities/:name/bulk', async (request, reply) => conSaleBloccate(await saleCoinvolte(request), async () => {
		const entityName = request.params.name;
		if (CREATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: CREATE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		const source = Array.isArray(request.body) ? request.body : [];
		// Un evento genera al massimo 104 lezioni: 500 righe per volta bastano e avanzano.
		if (source.length > MASSIMO_CREAZIONE_MULTIPLA) {
			return reply.code(400).send({ error: `Al massimo ${MASSIMO_CREAZIONE_MULTIPLA} righe per volta.` });
		}
		const items = [];
		for (const item of source) {
			const ricevuto = togliFirmaInScrittura(togliCampiDiSistema(item));
			verificaCampiFile(ricevuto);
			if (await riferimentoAltrui(request, entityName, ricevuto)) return reply.code(404).send({ error: 'Non trovato' });
			let riga = await applyWriteTransform(entityName, ricevuto, { utente: request.utente });
			// L'appartenenza va imposta anche qui, non solo sulla creazione singola: finché
			// mancava, bastava passare da /bulk invece che dalla rotta normale per creare
			// righe intestate a un altro socio — il controllo c'era, e si aggirava
			// cambiando indirizzo.
			if (request.memberId) riga = forzaProprietario(entityName, riga, request.memberId);
			items.push(translateToJs(table, riga));
		}
		if (!items.length) return [];
		const rows = await db.insert(table).values(items).returning();
		// Una voce sola per la creazione multipla: 104 lezioni generate da un evento sono
		// un'azione, non 104.
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: tipoEntita(entityName), entitaNome: `${rows.length} righe`,
			dettagli: `Creazione multipla: ${rows.length}`,
		}, request.log);
		reply.code(201);
		return conCampiCalcolatiMolte(entityName, firmaFileInLetturaMolte(stripHiddenFieldsMany(entityName, translateManyToSnakeCase(table, rows))));
	}));

	/**
	 * Se la riga che un socio sta per modificare o cancellare è davvero sua.
	 *
	 * La lettura era già filtrata, la creazione già intestata d'ufficio, ma modifica e
	 * cancellazione no: bastava l'identificativo di una riga altrui — e per un socio che
	 * legge i propri allenamenti gli identificativi altrui non sono nemmeno difficili da
	 * indovinare — per riscrivere l'allenamento di un altro. Serve da quando il portale
	 * chiude una sessione aggiornandola, ma il buco c'era già.
	 *
	 * Risponde "non trovato" e non "vietato": a chi non deve vedere una riga non si
	 * conferma nemmeno che esista.
	 */
	async function rigaNonSua(request, entityName, table) {
		if (!request.memberId) return false;
		// La colonna della scrittura, non quella della lettura: le prenotazioni si leggono
		// tutte ma si modificano solo le proprie, e con la colonna di lettura un socio
		// potrebbe disdire la prenotazione di chiunque.
		const colonna = colonnaProprietarioScrittura(entityName);
		if (!colonna) return false;
		const { dbNameToColumn, dbNameToJsKey } = getColumnMaps(table);
		const [row] = await db.select().from(table).where(eq(dbNameToColumn.id, request.params.id)).limit(1);
		if (!row) return true;
		return String(row[dbNameToJsKey[colonna]]) !== String(request.memberId);
	}

	/**
	 * Le sale che una scrittura tocca, da tenere ferme mentre la si controlla e la si esegue
	 * (vedi `conSaleBloccate`): la sala stessa, quella in cui nasce un evento o una lezione, e —
	 * per uno spostamento — sia quella di partenza sia quella d'arrivo.
	 */
	async function saleCoinvolte(request) {
		const entityName = request.params.name;
		if (!['Room', 'Event', 'Session'].includes(entityName)) return [];
		if (entityName === 'Room') return request.params.id ? [request.params.id] : [];
		const corpi = Array.isArray(request.body) ? request.body : [request.body ?? {}];
		const sale = corpi.map((c) => c?.room_id).filter(Boolean);
		if (request.params.id) {
			const tabella = entityRegistry[entityName];
			const { dbNameToColumn, dbNameToJsKey } = getColumnMaps(tabella);
			const [attuale] = await db.select().from(tabella).where(eq(dbNameToColumn.id, request.params.id)).limit(1);
			if (attuale) sale.push(attuale[dbNameToJsKey.room_id]);
		}
		return sale;
	}

	/**
	 * Se un socio sta citando la scheda o l'allenamento di un altro.
	 *
	 * L'intestazione della riga la impone `forzaProprietario`, ma i riferimenti no: un socio
	 * avviava un allenamento con il `plan_id` della scheda di un altro, e poi il portale gli
	 * restituiva le routine di quella scheda. Serve conoscere l'id, ma resta un accesso ai dati
	 * di un altro. Risponde come `rigaNonSua`: a chi non deve vedere una riga non si conferma
	 * nemmeno che esista.
	 */
	async function riferimentoAltrui(request, entityName, corpo) {
		if (!request.memberId || !corpo) return false;
		const controlli = [];
		if ((entityName === 'WorkoutSession' || entityName === 'WorkoutLog') && corpo.plan_id) {
			controlli.push([entityRegistry.ExercisePlan, corpo.plan_id]);
		}
		if (entityName === 'WorkoutLog' && corpo.session_id) {
			controlli.push([entityRegistry.WorkoutSession, corpo.session_id]);
		}
		for (const [tabella, id] of controlli) {
			const { dbNameToColumn, dbNameToJsKey } = getColumnMaps(tabella);
			const [riga] = await db.select().from(tabella).where(eq(dbNameToColumn.id, id)).limit(1);
			if (!riga || String(riga[dbNameToJsKey.member_id]) !== String(request.memberId)) return true;
		}
		return false;
	}

	// PUT /api/entities/:name/:id
	fastify.put('/api/entities/:name/:id', async (request, reply) => conSaleBloccate(await saleCoinvolte(request), async () => {
		const entityName = request.params.name;
		if (UPDATE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: UPDATE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		if (await rigaNonSua(request, entityName, table)) {
			return reply.code(404).send({ error: 'Non trovato' });
		}
		const bloccato = await mutationBlockedReason(entityName, table, request.params.id, 'update', request.body);
		if (bloccato) return reply.code(400).send(typeof bloccato === 'string' ? { error: bloccato } : bloccato);
		const { dbNameToColumn } = getColumnMaps(table);
		const ricevuto = togliFirmaInScrittura(togliCampiDiSistema(request.body));
		verificaCampiFile(ricevuto);
		if (await riferimentoAltrui(request, entityName, ricevuto)) return reply.code(404).send({ error: 'Non trovato' });
		let body = await applyWriteTransform(entityName, ricevuto, { creazione: false, utente: request.utente, id: request.params.id });
		// Nemmeno con una modifica si cambia intestatario: senza, un socio potrebbe
		// spostare a un altro una riga sua, o prendersi la riga di qualcun altro in due passi.
		if (request.memberId) body = forzaProprietario(entityName, body, request.memberId);
		const data = translateToJs(table, body);
		// Com'era la riga prima: serve al registro (cosa è cambiato) e ai file (una foto
		// sostituita va cancellata dal disco).
		const campiFileToccati = colonneFile(table).map(([nome]) => nome).filter((nome) => nome in body);
		const [prima] = await db.select().from(table).where(eq(dbNameToColumn.id, request.params.id)).limit(1);
		const [row] = await db.update(table).set(data).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		// Una capienza cresciuta libera posti: chi è in lista d'attesa entra, in ordine.
		if (entityName === 'Session' && 'capacity' in body) {
			await db.transaction((tx) => promuoviFinoACapienza(tx, row.id));
		}
		const vecchia = prima ? translateToSnakeCase(table, prima) : null;
		const nuova = translateToSnakeCase(table, row);
		if (vecchia) {
			const cambiati = campiFileToccati.filter((nome) => vecchia[nome] && vecchia[nome] !== nuova[nome]);
			if (cambiati.length) await cancellaFileNonPiuUsati(table, vecchia, cambiati);
		}
		// Il corpo com'è arrivato (con `password`), non quello trasformato (con l'hash): il
		// registro deve sapere che la password è cambiata, non come.
		await registra(request.utente, {
			...descriviModifica(vecchia, { ...body, ...(ricevuto?.password ? { password: true } : {}) }),
			entitaTipo: tipoEntita(entityName), entitaNome: nomeLeggibile(nuova), entitaId: row.id,
		}, request.log);
		return conCampiCalcolati(entityName, firmaFileInLettura(stripHiddenFields(entityName, nuova)));
	}));

	// DELETE /api/entities/:name/:id
	fastify.delete('/api/entities/:name/:id', async (request, reply) => conSaleBloccate(await saleCoinvolte(request), async () => {
		const entityName = request.params.name;
		if (DELETE_FORBIDDEN[entityName]) {
			return reply.code(400).send({ error: DELETE_FORBIDDEN[entityName] });
		}
		const table = entityRegistry[entityName];
		if (await rigaNonSua(request, entityName, table)) {
			return reply.code(404).send({ error: 'Non trovato' });
		}
		const bloccato = await mutationBlockedReason(entityName, table, request.params.id, 'delete');
		if (bloccato) return reply.code(400).send(typeof bloccato === 'string' ? { error: bloccato } : bloccato);
		const { dbNameToColumn } = getColumnMaps(table);
		const [row] = await db.delete(table).where(eq(dbNameToColumn.id, request.params.id)).returning();
		if (!row) return reply.code(404).send({ error: 'Non trovato' });
		// Eliminare un documento vuol dire eliminare anche il file: un certificato medico che
		// resta sul disco dopo un "non si può recuperare" non è stato eliminato.
		const eliminata = translateToSnakeCase(table, row);
		await cancellaFileNonPiuUsati(table, eliminata);
		await registra(request.utente, {
			tipoAzione: 'delete', entitaTipo: tipoEntita(entityName), entitaNome: nomeLeggibile(eliminata), entitaId: row.id,
		}, request.log);
		return { success: true };
	}));
}
