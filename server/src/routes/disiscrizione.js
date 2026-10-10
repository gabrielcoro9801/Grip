// La disiscrizione dai messaggi promozionali: il link in fondo a ogni promozione.
//
// Aperta, senza accesso: chi non vuole più ricevere non deve ricordarsi una password. La firma
// nel link (lib/urlFirmati.js) dice per chi e per quale consenso l'abbiamo scritto noi.
//
// Si conferma con un pulsante (POST), non aprendo il link (GET): i filtri antispam e le
// anteprime dei programmi di posta aprono i link da soli, e una GET che disiscrive toglierebbe
// il consenso a chi non l'ha chiesto. I programmi di posta che offrono "disiscriviti" con un
// clic (RFC 8058) mandano già una POST, e quella vale subito.
//
// Toglie soltanto: il link non può dare un consenso. Finisce nel registro dei consensi con la
// fonte `disiscrizione`, come ogni altra scelta.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persone, consensi } from '../db/schema/index.js';
import { disiscrizioneValida } from '../lib/urlFirmati.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { TIPI_CONSENSO } from '../../../shared/consensi.js';

const escape = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Una pagina piccola e autonoma: niente script (la CSP non li ammetterebbe scritti qui), stili in linea.
function pagina(titolo, corpo) {
	return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(titolo)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1b1f24;line-height:1.5">
<h1 style="font-size:1.4rem">${escape(titolo)}</h1>${corpo}</body></html>`;
}

const leggi = (q = {}) => ({ personaId: String(q.p ?? ''), tipo: String(q.t ?? ''), firma: String(q.f ?? '') });
const valida = ({ personaId, tipo, firma }) => TIPI_CONSENSO.some((t) => t.valore === tipo) && disiscrizioneValida(personaId, tipo, firma);
const etichetta = (tipo) => TIPI_CONSENSO.find((t) => t.valore === tipo)?.etichetta.toLowerCase() ?? 'messaggi promozionali';

export default async function disiscrizioneRoutes(fastify) {
	registerPgErrorHandler(fastify);
	// Il modulo della pagina arriva come form; la POST "con un clic" dei programmi di posta pure.
	fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, corpo, fatto) => fatto(null, corpo));

	fastify.get('/disiscrizione', async (request, reply) => {
		reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
		const d = leggi(request.query);
		if (!valida(d)) return reply.code(404).send(pagina('Link non valido', '<p>Questo link di disiscrizione non è valido. Puoi chiedere in reception di non ricevere più messaggi promozionali.</p>'));
		const azione = `/disiscrizione?p=${encodeURIComponent(d.personaId)}&t=${encodeURIComponent(d.tipo)}&f=${encodeURIComponent(d.firma)}`;
		return pagina('Non ricevere più promozioni', `<p>Confermi di non voler più ricevere ${escape(etichetta(d.tipo))}?</p>
<form method="post" action="${escape(azione)}"><button type="submit" style="font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #1b1f24;background:#1b1f24;color:#fff">Sì, non inviarmele più</button></form>
<p style="color:#5b6470;font-size:.9rem">Continuerai a ricevere le comunicazioni di servizio (per esempio sulla scadenza dell'abbonamento). Puoi cambiare idea dal portale soci, nella tua anagrafica.</p>`);
	});

	fastify.post('/disiscrizione', async (request, reply) => {
		reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
		const d = leggi(request.query);
		if (!valida(d)) return reply.code(404).send(pagina('Link non valido', '<p>Questo link di disiscrizione non è valido.</p>'));
		const [persona] = await db.select({ id: persone.id }).from(persone).where(eq(persone.id, d.personaId)).limit(1);
		// Una persona cancellata nel frattempo non ha più consensi da togliere: si risponde lo stesso.
		if (persona) {
			await db.insert(consensi).values({ personaId: persona.id, tipo: d.tipo, valore: false, fonte: 'disiscrizione', autoreNome: 'Link di disiscrizione' });
		}
		return pagina('Fatto', `<p>Non riceverai più ${escape(etichetta(d.tipo))}.</p>`);
	});
}
