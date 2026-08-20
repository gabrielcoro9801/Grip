// Creazione della contabilità di partenza per un'organizzazione.
//
// Prima lo faceva il browser: `useOrganization` seminava piano dei conti e causali al
// caricamento della pagina, per mano di chiunque fosse autenticato. Significava che lo
// scheletro contabile dell'ente lo costruiva chi apriva l'applicazione per primo, con due
// conseguenze — nessun controllo su chi lo facesse, e due schede aperte insieme che
// potevano provare a crearlo entrambe.
//
// Qui è un'operazione del server, idempotente: se i conti ci sono già non tocca niente.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chartOfAccounts, causaliOperative, parametriFiscali } from '../db/schema/index.js';
import { DEFAULT_CHART_OF_ACCOUNTS, DEFAULT_CAUSALI } from '../../../shared/contabilitaPredefinita.js';
import { RUOLO_PER_CODICE_PREDEFINITO } from '../../../shared/contiSistema.js';
import { parametroAllaData } from '../../../shared/parametriFiscali.js';
import { bootstrapRuoli } from './ruoli.js';

/**
 * Crea i conti e le causali mancanti per l'organizzazione.
 *
 * @returns {{contiCreati:number, causaliCreate:number, ruoliCreati:number, aliquotaIva:number|null}}
 */
export async function bootstrapContabilita(organizationId) {
	// I ruoli nascono insieme al piano dei conti: sono entrambi lo scheletro con cui l'ente
	// comincia a lavorare.
	const ruoliCreati = await bootstrapRuoli(organizationId);
	const esistenti = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, organizationId));
	const codiciPresenti = new Set(esistenti.map((c) => c.codice));

	const daCreare = DEFAULT_CHART_OF_ACCOUNTS.filter((c) => !codiciPresenti.has(c.codice));
	let creati = [];
	if (daCreare.length > 0) {
		creati = await db
			.insert(chartOfAccounts)
			.values(daCreare.map((c) => ({
				organizationId,
				codice: c.codice,
				nome: c.nome,
				tipoConto: c.tipo_conto,
				natura: c.natura,
				gestisceIva: c.gestisce_iva ?? false,
				// Il compito è ciò che lega il conto al motore contabile; il codice qui accanto
				// è solo il punto di partenza, e l'ente può cambiarlo quando vuole.
				ruoloSistema: RUOLO_PER_CODICE_PREDEFINITO[c.codice] ?? null,
				sistema: true,
				attivo: true,
			})))
			.returning();
	}

	const tuttiIConti = [...esistenti, ...creati];
	const perCodice = new Map(tuttiIConti.map((c) => [c.codice, c]));

	// Le causali si creano solo se non ce n'è nessuna: se l'ente le ha già sistemate a modo
	// suo — rinominate, disattivate, sostituite — reintrodurre quelle predefinite sarebbe
	// un'ingerenza, non un aiuto.
	const causaliEsistenti = await db
		.select()
		.from(causaliOperative)
		.where(eq(causaliOperative.organizationId, organizationId));

	let causaliCreate = [];
	let aliquotaIva = null;
	if (causaliEsistenti.length === 0) {
		// L'aliquota ordinaria è un valore di legge: si legge quella in vigore oggi, non una
		// costante. Resta poi modificabile sulla singola causale.
		const righeParametri = (await db.select().from(parametriFiscali)).map((r) => ({
			chiave: r.chiave, valore: r.valore, valido_dal: r.validoDal,
		}));
		const oggi = new Date().toISOString().slice(0, 10);
		aliquotaIva = parametroAllaData(righeParametri, 'aliquota_iva_ordinaria', oggi)?.valore ?? null;

		const valori = DEFAULT_CAUSALI
			.map((c) => ({
				organizationId,
				nomeVisibile: c.nome_visibile,
				tipo: c.tipo,
				icona: c.icona,
				contoContropartitaId: perCodice.get(c.conto)?.id,
				richiedeControparte: c.richiede_controparte ?? false,
				tipoControparte: c.tipo_controparte ?? null,
				gestisceIva: c.gestisce_iva ?? false,
				aliquotaIvaDefault: c.gestisce_iva ? String(aliquotaIva ?? 0) : '0',
				permetteACredito: c.permette_a_credito ?? false,
				puoEssereIstituzionale: c.puo_essere_istituzionale ?? false,
				contoCreditoDebitoId: c.conto_credito ? perCodice.get(c.conto_credito)?.id ?? null : null,
				sistema: true,
				attivo: true,
			}))
			// Una causale senza conto di contropartita non serve a niente: meglio non crearla
			// che crearla rotta.
			.filter((c) => c.contoContropartitaId);

		if (valori.length > 0) {
			causaliCreate = await db.insert(causaliOperative).values(valori).returning();
		}
	}

	return { contiCreati: creati.length, causaliCreate: causaliCreate.length, ruoliCreati, aliquotaIva };
}
