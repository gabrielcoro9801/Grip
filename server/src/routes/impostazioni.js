// Le impostazioni di Da fare: quali segnali la palestra segue, e con quali soglie.
//
// Le soglie vivevano nella sezione Comunicazioni, ma decidono molto di più dei messaggi: gli stati
// dei soci, la lista di Da fare, il bancone, la dashboard. Qui stanno accanto agli interruttori
// dei segnali, ognuno con la sua regola in parole (shared/segnali.js, `regolaSegnale`).
//
// Le legge chi vede soci o contatti (servono a spiegare perché uno è in lista); le cambia solo
// l'amministratore (`admin_users`). Ogni cambio passa dal registro delle azioni.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { organizations } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { SOGLIE, soglieDi, sogliaValida } from '../../../shared/soglie.js';
import { CODICI_SEGNALE, etichettaSegnale } from '../../../shared/segnali.js';

/** La vista della pagina: le soglie in vigore (le scelte valide, le predefinite per il resto) e i segnali spenti. */
async function vista(conn = db) {
	const [p] = await conn.select({ impostazioni: organizations.impostazioni }).from(organizations).limit(1);
	const { segnaliSpenti, ...soglie } = soglieDi(p?.impostazioni);
	return { soglie, predefinite: SOGLIE, segnali_spenti: segnaliSpenti };
}

/** Le chiavi sconosciute o i valori fuori misura di un pezzo di soglie, come "segnali.assenzaGiorni". */
function soglieSbagliate(predefinite, date, percorso = '') {
	return Object.entries(date ?? {}).flatMap(([k, v]) => {
		if (!(k in predefinite)) return [`${percorso}${k}`];
		if (typeof predefinite[k] === 'object') return v && typeof v === 'object' ? soglieSbagliate(predefinite[k], v, `${percorso}${k}.`) : [`${percorso}${k}`];
		return sogliaValida(v, k) ? [] : [`${percorso}${k}`];
	});
}

/** Le scelte di prima con sopra le nuove, solo chiavi note e valori validi. */
function fondiScelte(predefinite, attuali = {}, nuove = {}) {
	return Object.fromEntries(Object.entries(predefinite).flatMap(([k, v]) => {
		if (typeof v === 'object') {
			const dentro = fondiScelte(v, attuali?.[k], nuove?.[k]);
			return Object.keys(dentro).length ? [[k, dentro]] : [];
		}
		const scelto = nuove?.[k] !== undefined ? nuove[k] : attuali?.[k];
		return sogliaValida(scelto, k) ? [[k, scelto]] : [];
	}));
}

export default async function impostazioniRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		const legge = request.method === 'GET';
		const puo = legge
			? ['crm_members', 'crm_leads', 'admin_users'].some((m) => canAccess(utente.ruolo, m, 'view'))
			: canAccess(utente.ruolo, 'admin_users', 'edit');
		if (utente.ruolo === 'member' || !puo) {
			return reply.code(403).send({ error: legge ? 'Non consentito.' : 'Solo l\'amministratore cambia le impostazioni di Da fare.' });
		}
		request.utente = utente;
	});

	/** GET /api/impostazioni/da-fare → { soglie, predefinite, segnali_spenti } */
	fastify.get('/api/impostazioni/da-fare', async () => vista());

	/**
	 * PUT /api/impostazioni/da-fare { soglie?: { segnali: { … }, lead: { … }, … }, segnali_spenti?: [codice] }
	 *
	 * Si salvano solo chiavi note e valori sensati (interi da 1 a 3650; l'archiviazione anche 0,
	 * "mai"): una soglia sbagliata non deve svuotare né riempire le liste di lavoro. Un valore
	 * uguale al predefinito si salva lo stesso: la palestra l'ha scelto.
	 */
	fastify.put('/api/impostazioni/da-fare', async (request, reply) => {
		const { soglie: scelte, segnali_spenti: spenti } = request.body ?? {};
		const sbagliate = scelte === undefined ? [] : soglieSbagliate(SOGLIE, scelte);
		if (sbagliate.length) {
			return reply.code(400).send({ error: `Soglie non valide: ${sbagliate.join(', ')} (numeri interi da 1 a 3650; l'archiviazione anche 0).` });
		}
		if (spenti !== undefined && (!Array.isArray(spenti) || spenti.some((c) => !CODICI_SEGNALE.includes(c)))) {
			return reply.code(400).send({ error: 'Segnali sconosciuti fra quelli da spegnere.' });
		}

		const prima = await vista();
		await db.transaction(async (tx) => {
			const [p] = await tx.select().from(organizations).limit(1).for('update');
			const impostazioni = { ...(p.impostazioni ?? {}) };
			if (scelte !== undefined) impostazioni.soglie = fondiScelte(SOGLIE, impostazioni.soglie, scelte);
			if (spenti !== undefined) impostazioni.segnali_spenti = [...new Set(spenti)];
			await tx.update(organizations).set({ impostazioni }).where(eq(organizations.id, p.id));
		});
		const dopo = await vista();

		const spentiOra = dopo.segnali_spenti.filter((c) => !prima.segnali_spenti.includes(c));
		const riaccesi = prima.segnali_spenti.filter((c) => !dopo.segnali_spenti.includes(c));
		const dettagli = [
			spentiOra.length && `Spenti: ${spentiOra.map(etichettaSegnale).join(', ')}`,
			riaccesi.length && `Riaccesi: ${riaccesi.map(etichettaSegnale).join(', ')}`,
			scelte !== undefined && JSON.stringify(prima.soglie) !== JSON.stringify(dopo.soglie) && 'Soglie cambiate',
		].filter(Boolean).join('; ');
		if (dettagli) {
			await registra(request.utente, {
				tipoAzione: 'update', entitaTipo: 'impostazioni', entitaNome: 'Da fare', dettagli,
				valorePrecedente: JSON.stringify({ soglie: prima.soglie, segnali_spenti: prima.segnali_spenti }),
				valoreNuovo: JSON.stringify({ soglie: dopo.soglie, segnali_spenti: dopo.segnali_spenti }),
			}, request.log);
		}
		return dopo;
	});
}
