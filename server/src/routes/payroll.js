// Registrazione contabile degli stipendi di un mese.
//
// Il cedolino lo calcola il consulente del lavoro: qui si registra ciò che ne consegue per
// la contabilità. Il punto delicato è che il costo per l'ente non coincide né con il lordo
// né con il netto:
//
//   lordo         = netto + IRPEF + contributi dipendente + trattenute a terzi
//   costo per ente = lordo + contributi azienda + accantonamento TFR
//
// La prima identità dice se il cedolino è stato trascritto correttamente; la seconda è il
// costo vero. Le trattenute a terzi (cessione del quinto, quote sindacali) non sono un
// costo: sono denaro del dipendente che transita dall'ente verso qualcun altro.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	payslips, payrollRuns, collaboratori,
	journalEntries, journalLines, chartOfAccounts, numberingCounters,
} from '../db/schema/index.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { anniChiusi } from './exerciseClosures.js';

// Tolleranza sul controllo delle identità: i cedolini sono arrotondati al centesimo e
// qualche spicciolo di differenza è fisiologico, un euro no.
const TOLLERANZA = 0.02;

const CONTI = {
	salari: '7.6',
	oneriSociali: '7.10',
	accantonamentoTfr: '7.11',
	dipendenti: '4.4',
	erario: '4.5',
	inps: '4.6',
	fondoTfr: '4.7',
	terzi: '4.9',
};

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

const n = (v) => Number(v) || 0;

export default async function payrollRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (!canAccess(user.ruolo, 'personale', 'edit')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di registrare gli stipendi.' });
		}
		request.currentUser = user;
	});

	// POST /api/payroll-runs  { organization_id, periodo_anno, periodo_mese, data_registrazione }
	// Genera un'unica scrittura aggregata per il mese, a partire dai cedolini inseriti.
	fastify.post('/api/payroll-runs', async (request, reply) => {
		const {
			organization_id: organizationId,
			periodo_anno: annoRaw,
			periodo_mese: meseRaw,
			data_registrazione: dataRegistrazione,
		} = request.body ?? {};

		const anno = Number(annoRaw);
		const mese = Number(meseRaw);
		if (!organizationId || !Number.isInteger(anno) || !Number.isInteger(mese)) {
			return reply.code(400).send({ error: 'Indicare organizzazione, anno e mese.' });
		}

		const dataCompetenza = dataRegistrazione || `${anno}-${String(mese + 1).padStart(2, '0')}-01`;
		const chiusi = await anniChiusi(organizationId);
		if (chiusi.has(Number(String(dataCompetenza).slice(0, 4)))) {
			return reply.code(400).send({ error: `L'esercizio ${String(dataCompetenza).slice(0, 4)} è chiuso.` });
		}

		const [giaRegistrato] = await db
			.select()
			.from(payrollRuns)
			.where(and(
				eq(payrollRuns.organizationId, organizationId),
				eq(payrollRuns.periodoAnno, anno),
				eq(payrollRuns.periodoMese, mese),
			))
			.limit(1);
		if (giaRegistrato) {
			return reply.code(400).send({ error: 'Gli stipendi di questo mese sono già stati registrati in contabilità.' });
		}

		const cedolini = await db
			.select()
			.from(payslips)
			.where(and(
				eq(payslips.organizationId, organizationId),
				eq(payslips.periodoAnno, anno),
				eq(payslips.periodoMese, mese),
			));
		if (cedolini.length === 0) {
			return reply.code(400).send({ error: 'Nessun cedolino inserito per questo mese.' });
		}

		// Controllo di coerenza su ogni cedolino prima di registrare: un errore di
		// trascrizione scoperto dopo significa correggere una scrittura contabile.
		const incoerenti = cedolini.filter((c) => {
			const somma = n(c.nettoDipendente) + n(c.ritenuteIrpef) + n(c.contributiDipendente) + n(c.trattenuteTerzi);
			return Math.abs(somma - n(c.retribuzioneLorda)) > TOLLERANZA;
		});
		if (incoerenti.length > 0) {
			return reply.code(400).send({
				error: `${incoerenti.length} cedolini non quadrano: netto, IRPEF, contributi e trattenute devono sommare al lordo.`,
			});
		}

		// La destinazione del TFR è del singolo dipendente: chi lo lascia in azienda
		// alimenta il fondo, chi lo destina a previdenza complementare genera un debito
		// da versare come i contributi.
		const collabIds = [...new Set(cedolini.map((c) => c.collaboratoreId))];
		const collabRows = await db.select().from(collaboratori).where(inArray(collaboratori.id, collabIds));
		const destinazioneTfr = new Map(collabRows.map((c) => [c.id, c.destinazioneTfr || 'azienda']));

		const tot = cedolini.reduce((a, c) => {
			const tfr = n(c.accantonamentoTfr);
			const versato = destinazioneTfr.get(c.collaboratoreId) === 'fondo_pensione';
			return {
				lordo: a.lordo + n(c.retribuzioneLorda),
				netto: a.netto + n(c.nettoDipendente),
				irpef: a.irpef + n(c.ritenuteIrpef),
				contributiDip: a.contributiDip + n(c.contributiDipendente),
				terzi: a.terzi + n(c.trattenuteTerzi),
				contributiAz: a.contributiAz + n(c.contributiAzienda),
				tfr: a.tfr + tfr,
				// Il TFR destinato a un fondo esterno è comunque un costo, ma diventa un
				// debito da versare invece di un fondo interno che si accumula.
				tfrDaVersare: a.tfrDaVersare + (versato ? tfr : 0),
			};
		}, { lordo: 0, netto: 0, irpef: 0, contributiDip: 0, terzi: 0, contributiAz: 0, tfr: 0, tfrDaVersare: 0 });

		const arr = (v) => Math.round(v * 100) / 100;
		const costoTotale = arr(tot.lordo + tot.contributiAz + tot.tfr);

		const conti = await db
			.select()
			.from(chartOfAccounts)
			.where(eq(chartOfAccounts.organizationId, organizationId));
		const perCodice = new Map(conti.map((c) => [c.codice, c]));
		const mancanti = Object.values(CONTI).filter((codice) => !perCodice.has(codice));
		if (mancanti.length > 0) {
			return reply.code(400).send({
				error: `Mancano dei conti nel piano dei conti: ${mancanti.join(', ')}. Il piano predefinito li contiene: aggiungili prima di registrare gli stipendi.`,
			});
		}

		const righe = [
			{ codice: CONTI.salari, dare: arr(tot.lordo) },
			{ codice: CONTI.oneriSociali, dare: arr(tot.contributiAz) },
			{ codice: CONTI.accantonamentoTfr, dare: arr(tot.tfr) },
			{ codice: CONTI.dipendenti, avere: arr(tot.netto) },
			{ codice: CONTI.erario, avere: arr(tot.irpef) },
			// L'INPS incassa sia la quota trattenuta al dipendente sia quella dell'ente,
			// più il TFR di chi lo destina a previdenza complementare.
			{ codice: CONTI.inps, avere: arr(tot.contributiDip + tot.contributiAz + tot.tfrDaVersare) },
			{ codice: CONTI.fondoTfr, avere: arr(tot.tfr - tot.tfrDaVersare) },
			{ codice: CONTI.terzi, avere: arr(tot.terzi) },
		].filter((r) => (r.dare ?? 0) > 0 || (r.avere ?? 0) > 0);

		const totDare = righe.reduce((s, r) => s + (r.dare ?? 0), 0);
		const totAvere = righe.reduce((s, r) => s + (r.avere ?? 0), 0);
		if (Math.abs(totDare - totAvere) > TOLLERANZA) {
			return reply.code(400).send({
				error: `La scrittura non quadra: dare ${totDare.toFixed(2)}, avere ${totAvere.toFixed(2)}. Verifica i dati dei cedolini.`,
			});
		}

		const registrazione = await db.transaction(async (tx) => {
			const numeroProtocollo = await nextProtocolNumber(tx, organizationId);

			const [entry] = await tx
				.insert(journalEntries)
				.values({
					organizationId,
					numeroProtocollo,
					dataCompetenza,
					descrizione: `Stipendi ${String(mese + 1).padStart(2, '0')}/${anno} — ${cedolini.length} dipendenti`,
					causale: 'Retribuzioni del personale',
					tipoOrigine: 'stipendi',
					stato: 'confermata',
					// I debiti verso dipendenti, erario e istituti si saldano da Scadenzario,
					// ciascuno alla propria scadenza.
					statoPagamento: 'da_pagare',
					naturaFiscale: 'promiscua',
				})
				.returning();

			await tx.insert(journalLines).values(
				righe.map((r) => ({
					journalEntryId: entry.id,
					contoId: perCodice.get(r.codice).id,
					dare: String(r.dare ?? 0),
					avere: String(r.avere ?? 0),
				}))
			);

			const [row] = await tx
				.insert(payrollRuns)
				.values({
					organizationId,
					periodoAnno: anno,
					periodoMese: mese,
					journalEntryId: entry.id,
					costoTotale: String(costoTotale),
				})
				.returning();

			return row;
		});

		reply.code(201);
		return translateToSnakeCase(payrollRuns, registrazione);
	});
}
