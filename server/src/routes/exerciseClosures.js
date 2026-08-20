// Chiusura dell'esercizio.
//
// Chiudere un anno fa due cose che vanno insieme o non vanno affatto:
//  1. gira il risultato a patrimonio netto, azzerando i conti di ricavo e costo. Senza,
//     l'anno successivo l'attivo non corrisponderebbe più a passivo + netto, perché
//     mancherebbe l'utile o la perdita maturati;
//  2. blocca le scritture su quell'anno: i dati sono già stati usati per una dichiarazione,
//     e modificarli dopo significherebbe avere numeri diversi da quelli presentati.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { exerciseClosures, journalEntries, journalLines, chartOfAccounts, numberingCounters } from '../db/schema/index.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { contiPerRuoli } from '../lib/contiSistema.js';
import { registerPgErrorHandler } from './errorHandler.js';


async function nextProtocolNumber(tx, organizationId) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (
			${organizationId}, 'journal_entry',
			COALESCE((SELECT MAX(numero_protocollo) FROM ${journalEntries} WHERE organization_id = ${organizationId}), 0) + 1
		)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

/** Anni già chiusi per un'organizzazione. */
export async function anniChiusi(organizationId) {
	const righe = await db
		.select({ anno: exerciseClosures.anno })
		.from(exerciseClosures)
		.where(eq(exerciseClosures.organizationId, organizationId));
	return new Set(righe.map((r) => r.anno));
}

export default async function exerciseClosureRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		// Chiudere un esercizio è irreversibile dall'interfaccia: resta all'amministratore.
		if (user.ruolo !== 'admin') {
			return reply.code(403).send({ error: 'Solo un amministratore può chiudere un esercizio.' });
		}
		request.currentUser = user;
	});

	// POST /api/exercise-closures  { organization_id, anno }
	fastify.post('/api/exercise-closures', async (request, reply) => {
		const { organization_id: organizationId, anno: annoRaw, note } = request.body ?? {};
		const anno = Number(annoRaw);
		if (!organizationId || !anno) {
			return reply.code(400).send({ error: 'Indicare organizzazione e anno da chiudere.' });
		}

		const [giaChiuso] = await db
			.select()
			.from(exerciseClosures)
			.where(and(eq(exerciseClosures.organizationId, organizationId), eq(exerciseClosures.anno, anno)))
			.limit(1);
		if (giaChiuso) return reply.code(400).send({ error: `L'esercizio ${anno} è già chiuso.` });

		// Un anno non si chiude se quello precedente è ancora aperto: il risultato si
		// accumula in ordine, e saltare un anno lascerebbe un buco nel patrimonio netto.
		const [precedente] = await db
			.select()
			.from(exerciseClosures)
			.where(and(eq(exerciseClosures.organizationId, organizationId), eq(exerciseClosures.anno, anno - 1)))
			.limit(1);
		const [primaScrittura] = await db
			.select({ anno: sql`EXTRACT(YEAR FROM MIN(${journalEntries.dataCompetenza}))`.as('anno') })
			.from(journalEntries)
			.where(eq(journalEntries.organizationId, organizationId));
		const primoAnno = Number(primaScrittura?.anno);
		if (primoAnno && anno > primoAnno && !precedente) {
			return reply.code(400).send({ error: `Prima di chiudere il ${anno} va chiuso l'esercizio ${anno - 1}.` });
		}

		// Saldi dei conti economici dell'anno: sono quelli da azzerare.
		const saldi = await db.execute(sql`
			SELECT c.id, c.tipo_conto,
			       COALESCE(SUM(l.dare), 0) AS dare,
			       COALESCE(SUM(l.avere), 0) AS avere
			FROM ${journalLines} l
			JOIN ${chartOfAccounts} c ON c.id = l.conto_id
			JOIN ${journalEntries} e ON e.id = l.journal_entry_id
			WHERE e.organization_id = ${organizationId}
			  AND e.stato = 'confermata'
			  AND EXTRACT(YEAR FROM e.data_competenza) = ${anno}
			  AND c.tipo_conto IN ('ricavo', 'costo')
			GROUP BY c.id, c.tipo_conto
		`);

		const righeChiusura = [];
		let totaleRicavi = 0;
		let totaleCosti = 0;

		for (const r of saldi.rows) {
			const dare = Number(r.dare) || 0;
			const avere = Number(r.avere) || 0;
			if (r.tipo_conto === 'ricavo') {
				const saldo = avere - dare;
				if (saldo === 0) continue;
				totaleRicavi += saldo;
				// Un conto di ricavo si azzera addebitandolo del proprio saldo.
				righeChiusura.push({ contoId: r.id, dare: saldo, avere: 0 });
			} else {
				const saldo = dare - avere;
				if (saldo === 0) continue;
				totaleCosti += saldo;
				righeChiusura.push({ contoId: r.id, dare: 0, avere: saldo });
			}
		}

		const risultato = Math.round((totaleRicavi - totaleCosti) * 100) / 100;

		if (righeChiusura.length === 0) {
			return reply.code(400).send({ error: `Nessuna scrittura confermata nel ${anno}: non c'è nulla da chiudere.` });
		}

		const { conti: contiRuolo, errore } = await contiPerRuoli(organizationId, ['utili_a_nuovo']);
		if (errore) return reply.code(400).send({ error: errore });
		const contoUtili = contiRuolo.utili_a_nuovo;

		// La contropartita porta il risultato a patrimonio netto: in avere se avanzo,
		// in dare se disavanzo.
		righeChiusura.push(
			risultato >= 0
				? { contoId: contoUtili.id, dare: 0, avere: risultato }
				: { contoId: contoUtili.id, dare: -risultato, avere: 0 }
		);

		const chiusura = await db.transaction(async (tx) => {
			const numeroProtocollo = await nextProtocolNumber(tx, organizationId);

			const [entry] = await tx
				.insert(journalEntries)
				.values({
					organizationId,
					numeroProtocollo,
					dataCompetenza: `${anno}-12-31`,
					descrizione: `Chiusura esercizio ${anno} — destinazione del risultato`,
					causale: 'Chiusura esercizio',
					tipoOrigine: 'chiusura_esercizio',
					stato: 'confermata',
					statoPagamento: 'saldata',
				})
				.returning();

			await tx.insert(journalLines).values(
				righeChiusura
					.filter((r) => r.dare > 0 || r.avere > 0)
					.map((r) => ({
						journalEntryId: entry.id,
						contoId: r.contoId,
						dare: String(r.dare),
						avere: String(r.avere),
					}))
			);

			const [row] = await tx
				.insert(exerciseClosures)
				.values({
					organizationId,
					anno,
					chiusoDa: request.currentUser.sub,
					journalEntryId: entry.id,
					risultato: String(risultato),
					note: note ?? null,
				})
				.returning();

			return row;
		});

		reply.code(201);
		return translateToSnakeCase(exerciseClosures, chiusura);
	});
}
