// Il codice d'accesso: chiederlo e verificarlo.
//
// Sono due rotte dedicate e non l'endpoint generico delle entità, perché entrambe hanno
// bisogno del segreto che firma il codice — e quel segreto non deve mai arrivare al
// browser. Il socio chiede il proprio codice, la reception verifica quello che ha davanti;
// nessuno dei due può calcolarlo per conto proprio.
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { qrAccessi, members } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { socioDiAccount } from '../auth/socioCorrente.js';
import { codiceDinamico, verificaCodice, semeDelCodice } from '../lib/qrDinamico.js';
import { msResiduiFinestra } from '../../../shared/qrDinamico.js';

export default async function qrRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		request.utente = utente;
	});

	/**
	 * Il codice del momento.
	 *
	 * Senza parametri restituisce il proprio, ed è così che lo chiede il socio. Con
	 * `?cliente_id=` restituisce quello di un socio, e lo può fare solo lo staff: serve
	 * alla reception per confrontare a vista quello che il socio ha sullo schermo.
	 */
	fastify.get('/api/qr/codice', async (request, reply) => {
		const { utente } = request;
		const clienteRichiesto = request.query.cliente_id;

		let clienteId = clienteRichiesto;
		if (utente.ruolo === 'member') {
			// Un socio ottiene il proprio e basta: il collegamento si rilegge dal database e
			// non dal token, così revocarlo ha effetto subito.
			const memberId = await socioDiAccount(utente.sub);
			if (!memberId) return reply.code(403).send({ error: 'Account non collegato a un socio.' });
			if (clienteRichiesto && clienteRichiesto !== memberId) {
				return reply.code(403).send({ error: 'Non consentito.' });
			}
			clienteId = memberId;
		} else if (!clienteId) {
			return reply.code(400).send({ error: 'Manca cliente_id.' });
		}

		const [qr] = await db
			.select()
			.from(qrAccessi)
			.where(and(eq(qrAccessi.clienteId, clienteId), eq(qrAccessi.stato, 'attivo')))
			.limit(1);

		// Nessun codice attivo non è un errore: è la risposta giusta per chi è stato
		// revocato o non ne ha mai avuto uno, e l'interfaccia deve poterlo dire.
		if (!qr) return { codice: null, stato: 'assente', ms_residui: msResiduiFinestra() };

		return {
			codice: codiceDinamico(qr.codice),
			stato: 'attivo',
			ms_residui: msResiduiFinestra(),
		};
	});

	/**
	 * Se il codice che si ha davanti è valido adesso, e di chi è.
	 *
	 * La verifica sta qui perché è l'unico posto che ha la chiave. È anche il posto giusto
	 * per controllare che il codice non sia stato revocato: la revoca deve pesare sul
	 * controllo alla porta, non su cosa il socio riesce a farsi disegnare sullo schermo.
	 */
	fastify.post('/api/qr/verifica', async (request, reply) => {
		if (request.utente.ruolo === 'member') {
			return reply.code(403).send({ error: 'Non consentito.' });
		}
		const scansionato = String(request.body?.codice ?? '').trim().toUpperCase();
		const seme = semeDelCodice(scansionato);
		if (!seme) return { valido: false, motivo: 'Codice illeggibile.' };

		const [qr] = await db.select().from(qrAccessi).where(eq(qrAccessi.codice, seme)).limit(1);
		if (!qr) return { valido: false, motivo: 'Codice sconosciuto.' };
		if (qr.stato !== 'attivo') return { valido: false, motivo: 'Codice revocato.' };
		if (!verificaCodice(qr.codice, scansionato)) {
			return { valido: false, motivo: 'Codice scaduto: fattelo mostrare di nuovo.' };
		}

		const [socio] = await db
			.select({ id: members.id, nome: members.fullName })
			.from(members)
			.where(eq(members.id, qr.clienteId))
			.limit(1);

		return { valido: true, member_id: qr.clienteId, member_name: socio?.nome ?? qr.clienteName ?? '' };
	});
}
