// Scrittura di una registrazione contabile: testata + righe, in una sola transazione.
//
// Perché non basta l'endpoint generico delle entità: una registrazione in partita doppia
// è un'unica unità contabile. Creandola con due chiamate separate — prima la testata, poi
// le righe — un errore o una disconnessione nel mezzo lascia una testata senza righe, cioè
// una registrazione che non quadra e che nessuno si accorge di dover correggere.
// Qui o si scrive tutto o non si scrive niente.
//
// Lo stesso vale per il numero di protocollo: assegnarlo leggendo il massimo esistente e
// sommando 1 fa sì che due operazioni simultanee ottengano lo stesso numero. Qui arriva da
// un contatore incrementato dentro la transazione.
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { journalEntries, journalLines, chartOfAccounts, numberingCounters } from '../db/schema/index.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canCreateManualEntry, canWriteEntity } from '../auth/authorize.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { erroreEsercizioChiuso } from './exerciseClosures.js';
import { erroreNaturaFiscale } from '../../../shared/naturaFiscale.js';

const SCOPE = 'journal_entry';

// Tolleranza sul confronto fra dare e avere: gli importi nascono da divisioni per lo
// scorporo dell'IVA, quindi l'uguaglianza esatta fra binari non è garantita. Mezzo
// centesimo è sotto la soglia di ciò che è rappresentabile in contabilità.
const TOLLERANZA = 0.005;

// Il primo numero per un'organizzazione riparte dal massimo già presente, così il
// contatore resta coerente con le registrazioni create prima della sua introduzione.
async function nextProtocolNumber(tx, organizationId) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (
			${organizationId},
			${SCOPE},
			COALESCE((SELECT MAX(numero_protocollo) FROM ${journalEntries} WHERE organization_id = ${organizationId}), 0) + 1
		)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

export default async function journalEntryRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) {
			return reply.code(401).send({ error: 'Non autenticato.' });
		}
		// Il controllo sul ruolo più avanti riguarda solo le registrazioni manuali: senza
		// questo, chiunque fosse autenticato — un socio del portale compreso — poteva
		// scrivere in contabilità dichiarando una qualunque altra origine.
		if (!canWriteEntity(user.ruolo, 'JournalEntry')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di scrivere in contabilità.' });
		}
		request.currentUser = user;
	});

	// POST /api/journal-entries  { entry: {...}, lines: [{...}] }
	fastify.post('/api/journal-entries', async (request, reply) => {
		const { entry: entryInput, lines: linesInput } = request.body ?? {};

		if (!entryInput?.organization_id) {
			return reply.code(400).send({ error: 'organization_id è obbligatorio.' });
		}

		// Un esercizio chiuso non si tocca più: i suoi dati sono già stati usati per una
		// dichiarazione. La scrittura di chiusura è l'unica eccezione, perché è proprio
		// l'operazione che chiude l'anno.
		if (entryInput.data_competenza && entryInput.tipo_origine !== 'chiusura_esercizio') {
			const erroreEsercizio = await erroreEsercizioChiuso(entryInput.organization_id, entryInput.data_competenza);
			if (erroreEsercizio) return reply.code(400).send({ error: erroreEsercizio });
		}

		// Le registrazioni manuali sono l'unica via per movimentare conti scavalcando le
		// causali: riservate all'amministratore e sempre motivate.
		if (entryInput.tipo_origine === 'manuale') {
			if (!canCreateManualEntry(request.currentUser.ruolo)) {
				return reply.code(403).send({ error: 'Solo un amministratore può inserire registrazioni manuali.' });
			}
			if (!entryInput.motivo_manuale?.trim()) {
				return reply.code(400).send({ error: 'Indicare il motivo della registrazione manuale.' });
			}
		}
		if (!Array.isArray(linesInput) || linesInput.length === 0) {
			return reply.code(400).send({ error: 'Una registrazione deve avere almeno una riga.' });
		}

		// Una registrazione confermata deve quadrare. Le bozze no: servono proprio a
		// salvare un lavoro incompleto per riprenderlo dopo.
		if (entryInput.stato === 'confermata') {
			const totaleDare = linesInput.reduce((s, l) => s + (Number(l.dare) || 0), 0);
			const totaleAvere = linesInput.reduce((s, l) => s + (Number(l.avere) || 0), 0);
			if (Math.abs(totaleDare - totaleAvere) > TOLLERANZA) {
				return reply.code(400).send({
					error: `Registrazione non quadrata: dare ${totaleDare.toFixed(2)}, avere ${totaleAvere.toFixed(2)}.`,
				});
			}
		}

		// La natura fiscale va verificata qui, non lasciata al CHECK del database: il CHECK
		// scarta solo i valori fuori enum, non sa dire se la registrazione ne aveva davvero
		// bisogno perché tocca un conto di ricavo o di costo.
		const contiCoinvolti = await db
			.select({ id: chartOfAccounts.id, tipoConto: chartOfAccounts.tipoConto })
			.from(chartOfAccounts)
			.where(inArray(chartOfAccounts.id, linesInput.map((l) => l.conto_id).filter(Boolean)));
		const contiPerId = Object.fromEntries(
			contiCoinvolti.map((c) => [c.id, { tipo_conto: c.tipoConto }])
		);
		const erroreNatura = erroreNaturaFiscale({
			tipoOrigine: entryInput.tipo_origine,
			naturaFiscale: entryInput.natura_fiscale,
			righe: linesInput,
			contiPerId,
		});
		if (erroreNatura) return reply.code(400).send({ error: erroreNatura });

		const created = await db.transaction(async (tx) => {
			// Il numero arriva sempre dal contatore: un valore inviato dal client verrebbe
			// da una lettura ormai obsoleta.
			const { numero_protocollo: _ignored, ...entryFields } = entryInput;
			const numeroProtocollo = await nextProtocolNumber(tx, entryInput.organization_id);

			const [entry] = await tx
				.insert(journalEntries)
				.values({ ...translateToJs(journalEntries, entryFields), numeroProtocollo })
				.returning();

			await tx.insert(journalLines).values(
				linesInput.map((line) => ({
					...translateToJs(journalLines, line),
					journalEntryId: entry.id,
				}))
			);

			return entry;
		});

		reply.code(201);
		return translateToSnakeCase(journalEntries, created);
	});

	// PUT /api/journal-entries/:id/settle — collega la registrazione originale alla
	// scrittura di saldo. Resta separato perché aggiorna una registrazione già esistente.
	fastify.put('/api/journal-entries/:id/settle', async (request, reply) => {
		const { journal_entry_saldo_id: saldoId } = request.body ?? {};

		const [originale] = await db
			.select({ organizationId: journalEntries.organizationId, dataCompetenza: journalEntries.dataCompetenza })
			.from(journalEntries)
			.where(eq(journalEntries.id, request.params.id))
			.limit(1);
		if (!originale) return reply.code(404).send({ error: 'Registrazione non trovata.' });

		const erroreEsercizio = await erroreEsercizioChiuso(originale.organizationId, originale.dataCompetenza);
		if (erroreEsercizio) return reply.code(400).send({ error: erroreEsercizio });

		const [row] = await db
			.update(journalEntries)
			.set({ statoPagamento: 'saldata', journalEntrySaldoId: saldoId ?? null })
			.where(eq(journalEntries.id, request.params.id))
			.returning();
		if (!row) return reply.code(404).send({ error: 'Registrazione non trovata.' });
		return translateToSnakeCase(journalEntries, row);
	});
}
