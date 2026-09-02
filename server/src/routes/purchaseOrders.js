// Ciclo acquisti: il passaggio da "ordinato" a "consegnato" è l'unico momento del ciclo
// che tocca la contabilità, perché è quando il costo sorge davvero.
//
// Va fatto in transazione insieme alla scrittura: se si aggiornasse lo stato dell'ordine
// e poi fallisse la scrittura, l'ordine risulterebbe consegnato senza che il costo sia
// mai stato registrato — un buco che nessuno noterebbe finché non manca il debito.
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { purchaseOrders, journalEntries, journalLines, numberingCounters, accountingSuppliers, chartOfAccounts } from '../db/schema/index.js';
import { ritenutaDovuta, calcolaRitenuta } from '../../../shared/ritenuta.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { contiPerRuoli } from '../lib/contiSistema.js';
import { parametroFiscale } from '../lib/parametriFiscali.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { erroreEsercizioChiuso } from './exerciseClosures.js';
import { erroreNaturaFiscale } from '../../../shared/naturaFiscale.js';


async function nextProtocolNumber(tx, organizationId) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (
			${organizationId},
			'journal_entry',
			COALESCE((SELECT MAX(numero_protocollo) FROM ${journalEntries} WHERE organization_id = ${organizationId}), 0) + 1
		)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

export default async function purchaseOrderRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (!canWriteEntity(user.ruolo, 'PurchaseOrder')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		request.currentUser = user;
	});

	// POST /api/purchase-orders/:id/deliver  { data_consegna, importo?, conto_costo_id? }
	// Registra la consegna e, con essa, il costo e il debito verso il fornitore.
	fastify.post('/api/purchase-orders/:id/deliver', async (request, reply) => {
		const { data_consegna: dataConsegna, importo, conto_costo_id: contoCostoId } = request.body ?? {};
		if (!dataConsegna) return reply.code(400).send({ error: 'Indicare la data di consegna.' });

		const [ordine] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, request.params.id)).limit(1);
		if (!ordine) return reply.code(404).send({ error: 'Ordine non trovato.' });
		if (ordine.stato !== 'ordinato') {
			return reply.code(400).send({ error: `L'ordine è in stato "${ordine.stato}": solo un ordine ancora da consegnare può essere ricevuto.` });
		}

		// La consegna è uno dei quattro punti che inseriscono in journal_entries: senza
		// questo controllo era l'unico dei quattro a poter scrivere in un esercizio chiuso.
		const erroreEsercizio = await erroreEsercizioChiuso(ordine.organizationId, dataConsegna);
		if (erroreEsercizio) return reply.code(400).send({ error: erroreEsercizio });

		// Alla consegna può emergere che la quantità ricevuta vale meno o più del previsto:
		// il costo da registrare è quello effettivo, non quello stimato all'ordine.
		const importoEffettivo = Number(importo ?? ordine.importoPrevisto);
		if (!(importoEffettivo > 0)) {
			return reply.code(400).send({ error: "L'importo della consegna deve essere maggiore di zero." });
		}

		const contoCosto = contoCostoId ?? ordine.contoCostoId;
		if (!contoCosto) return reply.code(400).send({ error: 'Indicare il conto di costo su cui registrare la fornitura.' });

		// Stessa validazione che vale per le registrazioni manuali: la natura fiscale non è
		// verificata solo dal CHECK del database, perché quello non sa se serviva davvero.
		const [contoCostoRow] = await db
			.select({ tipoConto: chartOfAccounts.tipoConto })
			.from(chartOfAccounts)
			.where(eq(chartOfAccounts.id, contoCosto))
			.limit(1);
		const erroreNatura = erroreNaturaFiscale({
			tipoOrigine: 'ordine_fornitore',
			naturaFiscale: ordine.naturaFiscale,
			righe: [{ conto_id: contoCosto }],
			contiPerId: contoCostoRow ? { [contoCosto]: { tipo_conto: contoCostoRow.tipoConto } } : {},
		});
		if (erroreNatura) return reply.code(400).send({ error: erroreNatura });

		const { conti: contiRuolo, errore } = await contiPerRuoli(ordine.organizationId, ['debiti_fornitori']);
		if (errore) return reply.code(400).send({ error: errore });
		const contoDebiti = contiRuolo.debiti_fornitori;

		// Se il fornitore è un professionista soggetto a ritenuta, parte del compenso non
		// gli spetta: va versata all'erario. Il costo resta intero, il debito verso di lui
		// è il netto, e la ritenuta diventa un debito separato verso l'erario.
		const [fornitore] = await db
			.select()
			.from(accountingSuppliers)
			.where(eq(accountingSuppliers.id, ordine.fornitoreId))
			.limit(1);
		const fornitoreSnake = fornitore
			? {
				tipo_soggetto: fornitore.tipoSoggetto,
				regime_forfettario: fornitore.regimeForfettario,
				aliquota_ritenuta: fornitore.aliquotaRitenuta,
			}
			: null;

		// Il conto della ritenuta si pretende solo quando la ritenuta è dovuta: un ente che
		// non paga mai professionisti non deve essere costretto ad averlo.
		let contoRitenuta = null;
		let importoRitenuta = 0;
		if (ritenutaDovuta(fornitoreSnake)) {
			const { conti, errore: erroreRitenuta } = await contiPerRuoli(ordine.organizationId, ['erario_ritenute_autonomi']);
			if (erroreRitenuta) {
				return reply.code(400).send({ error: `Il fornitore è soggetto a ritenuta d'acconto. ${erroreRitenuta}` });
			}
			contoRitenuta = conti.erario_ritenute_autonomi;
			// L'aliquota è quella in vigore alla data della consegna, non quella di oggi.
			const aliquotaOrdinaria = await parametroFiscale("aliquota_ritenuta_acconto", dataConsegna);
			importoRitenuta = calcolaRitenuta(fornitoreSnake, importoEffettivo, aliquotaOrdinaria).ritenuta;
		}

		const aggiornato = await db.transaction(async (tx) => {
			const numeroProtocollo = await nextProtocolNumber(tx, ordine.organizationId);

			const [entry] = await tx
				.insert(journalEntries)
				.values({
					organizationId: ordine.organizationId,
					numeroProtocollo,
					dataCompetenza: dataConsegna,
					descrizione: `Fornitura: ${ordine.descrizione}`,
					causale: 'Consegna ordine fornitore',
					tipoOrigine: 'ordine_fornitore',
					stato: 'confermata',
					// Il debito resta aperto: si salda da Crediti/Debiti, come ogni altro debito.
					statoPagamento: 'da_pagare',
					naturaFiscale: ordine.naturaFiscale,
				})
				.returning();

			const righe = [
				{ journalEntryId: entry.id, contoId: contoCosto, dare: String(importoEffettivo), avere: '0' },
				{
					journalEntryId: entry.id,
					contoId: contoDebiti.id,
					dare: '0',
					// Al fornitore si deve il netto: la ritenuta la si versa all'erario.
					avere: String(importoEffettivo - importoRitenuta),
					controparteTipo: 'fornitore',
					controparteId: ordine.fornitoreId,
				},
			];
			if (importoRitenuta > 0) {
				righe.push({
					journalEntryId: entry.id,
					contoId: contoRitenuta.id,
					dare: '0',
					avere: String(importoRitenuta),
				});
			}
			await tx.insert(journalLines).values(righe);

			const [row] = await tx
				.update(purchaseOrders)
				.set({ stato: 'consegnato', dataConsegna, journalEntryId: entry.id, importoPrevisto: String(importoEffettivo) })
				.where(eq(purchaseOrders.id, ordine.id))
				.returning();

			return row;
		});

		return translateToSnakeCase(purchaseOrders, aggiornato);
	});
}
