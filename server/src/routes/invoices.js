// Emissione fatture verso clienti terzi.
//
// Il numero di fattura è assegnato dal server, dentro la stessa transazione che crea il
// documento. Su una fattura questo conta più che altrove: la numerazione dev'essere
// progressiva e senza salti né duplicati per esercizio, ed è uno dei primi elementi che
// un controllo verifica. Calcolarla leggendo il massimo esistente, come si faceva per le
// ricevute, con due emissioni simultanee produrrebbe due fatture con lo stesso numero.
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, numberingCounters, organizations, clients } from '../db/schema/index.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { nextNumber } from '../lib/numbering.js';
import { costruisciXmlFattura, nomeFileFattura, progressivoInvio, datiMancanti } from '../../../shared/fatturaElettronica.js';
import { registerPgErrorHandler } from './errorHandler.js';

// La numerazione delle fatture riparte da 1 ogni esercizio, quindi il contatore è
// per anno oltre che per organizzazione.
const scopeFatture = (anno) => `invoice_${anno}`;

async function nextInvoiceNumber(tx, organizationId, esercizio) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (
			${organizationId},
			${scopeFatture(esercizio)},
			COALESCE((
				SELECT MAX(numero_progressivo) FROM ${invoices}
				WHERE organization_id = ${organizationId} AND esercizio_fiscale = ${esercizio}
			), 0) + 1
		)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

export default async function invoiceRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (user.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
	});

	// POST /api/invoices — crea la fattura assegnandole il numero progressivo.
	fastify.post('/api/invoices', async (request, reply) => {
		const body = request.body ?? {};
		if (!body.organization_id) return reply.code(400).send({ error: 'organization_id è obbligatorio.' });
		if (!body.cliente_id) return reply.code(400).send({ error: 'Indicare il cliente intestatario.' });
		if (!body.data_emissione) return reply.code(400).send({ error: 'Indicare la data di emissione.' });

		const esercizio = Number(body.esercizio_fiscale) || new Date(body.data_emissione).getFullYear();

		const creata = await db.transaction(async (tx) => {
			// Un numero inviato dal client verrebbe da una lettura ormai obsoleta.
			const { numero_progressivo: _ignorato, ...campi } = body;
			const numero = await nextInvoiceNumber(tx, body.organization_id, esercizio);

			const [row] = await tx
				.insert(invoices)
				.values({
					...translateToJs(invoices, campi),
					numeroProgressivo: numero,
					esercizioFiscale: esercizio,
				})
				.returning();

			return row;
		});

		reply.code(201);
		return translateToSnakeCase(invoices, creata);
	});

	// GET /api/invoices/:id/xml — restituisce il file della fattura elettronica.
	//
	// L'applicazione si ferma qui: produce il file, non lo trasmette. La trasmissione allo
	// SdI resta di chi emette o del suo commercialista, ed è una scelta deliberata — il
	// canale va accreditato per ogni ente e porta con sé la conservazione a norma per dieci
	// anni, che è un obbligo separato dall'invio.
	//
	// Il file è generato al momento e non archiviato: i dati anagrafici possono essere
	// corretti dopo l'emissione, e una copia salvata resterebbe indietro senza che nessuno
	// se ne accorga. Quello che deve restare stabile è il numero di fattura, che è già in
	// banca dati.
	fastify.get('/api/invoices/:id/xml', async (request, reply) => {
		const [fattura] = await db.select().from(invoices).where(eq(invoices.id, request.params.id)).limit(1);
		if (!fattura) return reply.code(404).send({ error: 'Fattura non trovata.' });

		const [ente] = await db.select().from(organizations).where(eq(organizations.id, fattura.organizationId)).limit(1);
		const [cliente] = await db.select().from(clients).where(eq(clients.id, fattura.clienteId)).limit(1);
		if (!ente) return reply.code(400).send({ error: "Manca l'anagrafica dell'associazione." });
		if (!cliente) return reply.code(400).send({ error: 'Il cliente intestatario non esiste più.' });

		const emittente = translateToSnakeCase(organizations, ente);
		const intestatario = translateToSnakeCase(clients, cliente);
		const documento = translateToSnakeCase(invoices, fattura);

		// Si risponde con l'elenco puntuale invece di un errore generico: chi lo legge deve
		// sapere quale campo aprire, non che "manca qualcosa".
		const mancanti = datiMancanti({ emittente, cliente: intestatario, fattura: documento });
		if (mancanti.length) {
			return reply.code(400).send({
				error: 'Non è possibile generare la fattura elettronica: mancano dei dati.',
				mancanti,
			});
		}

		// Il progressivo identifica l'invio, non la fattura: due file con lo stesso nome
		// verrebbero scartati come duplicati, anche a distanza di anni. Serve quindi un
		// contatore che non torni mai indietro, nemmeno se il file viene rigenerato.
		const contatore = await nextNumber(db, fattura.organizationId, 'fattura_xml', sql`SELECT 0`);
		const progressivo = progressivoInvio(contatore);

		const xml = costruisciXmlFattura({
			emittente,
			cliente: intestatario,
			fattura: documento,
			trasmissione: { progressivo_invio: progressivo },
		});

		return reply
			.header('content-type', 'application/xml; charset=utf-8')
			.header('content-disposition', `attachment; filename="${nomeFileFattura(emittente.partita_iva, progressivo)}"`)
			.send(xml);
	});
}
