// Chi va seguito, e perché: il motore dei segnali (shared/segnali.js) per le schermate dello staff.
//
// Un endpoint per tutti: Oggi chiede le persone con qualcosa da fare, l'elenco dei soci filtra
// per fase e segnale, la scheda chiede una persona sola. I conti li fa lib/segnali.js.
//
// Chi può: chi vede i soci o i contatti, come il diario. Ognuno riceve solo la parte che vede:
// chi segue i contatti ma non i soci non riceve i soci, e viceversa.
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { situazioni } from '../lib/segnali.js';
import { daFare, perche, FASI } from '../../../shared/segnali.js';

const PUBBLICI = ['staff', 'socio', 'bancone'];

/** Una persona come la ricevono le schermate: i segnali del pubblico chiesto, dal più prezioso. */
function perLoSchermo(p, pubblico) {
	const segnali = p.segnali
		.filter((s) => s.pubblico === pubblico)
		.sort((a, b) => b.priorita - a.priorita)
		.map(({ nascostoFino, ...s }) => ({ ...s, nascosto_fino: nascostoFino }));
	const fare = daFare(p.segnali, pubblico);
	return { ...p, segnali, da_fare: fare.map((s) => s.codice), perche: perche(fare), priorita: fare[0]?.priorita ?? 0 };
}

export default async function segnaliRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		const soci = canAccess(utente.ruolo, 'crm_members', 'view');
		const lead = canAccess(utente.ruolo, 'crm_leads', 'view');
		if (utente.ruolo === 'member' || (!soci && !lead)) return reply.code(403).send({ error: 'Non consentito.' });
		request.vede = { soci, lead };
	});

	/**
	 * GET /api/segnali?persona=&tipo=soci|lead&fase=&segnale=&pubblico=staff&da_fare=1
	 * → { oggi, persone, conteggi: { fasi, segnali } }
	 *
	 * - `da_fare=1`: solo chi ha un segnale da fare adesso (non nascosto da un contatto o da un
	 *   rimando), dal più prezioso: è la lista di Oggi.
	 * - `fase`, `segnale`: filtri dell'elenco; `segnale` cerca fra quelli da fare.
	 * - `conteggi` si contano prima di `fase` e `segnale`, per le etichette dei filtri.
	 */
	fastify.get('/api/segnali', async (request, reply) => {
		const q = request.query ?? {};
		const pubblico = q.pubblico ?? 'staff';
		if (!PUBBLICI.includes(pubblico)) return reply.code(400).send({ error: 'Pubblico non valido.' });
		if (q.fase && !FASI.some((f) => f.valore === q.fase)) return reply.code(400).send({ error: 'Fase non valida.' });

		const { oggi, persone } = await situazioni({ personaId: q.persona || null });
		let elenco = persone
			.filter((p) => (p.socio_id ? request.vede.soci : request.vede.lead))
			.filter((p) => !q.tipo || (q.tipo === 'soci' ? p.socio_id : !p.socio_id))
			.map((p) => perLoSchermo(p, pubblico));

		const conteggi = { fasi: {}, segnali: {} };
		for (const p of elenco) {
			conteggi.fasi[p.fase] = (conteggi.fasi[p.fase] ?? 0) + 1;
			for (const s of p.da_fare) conteggi.segnali[s] = (conteggi.segnali[s] ?? 0) + 1;
		}

		if (q.da_fare === '1') elenco = elenco.filter((p) => p.da_fare.length);
		if (q.fase) elenco = elenco.filter((p) => p.fase === q.fase);
		if (q.segnale) elenco = elenco.filter((p) => p.da_fare.includes(q.segnale));
		elenco.sort((a, b) => (q.da_fare === '1' ? b.priorita - a.priorita : 0) || String(a.nome).localeCompare(String(b.nome), 'it'));
		return { oggi, persone: elenco, conteggi };
	});
}
