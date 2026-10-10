// Il giro quotidiano di manutenzione.
//
// Le cose che il CRM deve fare da solo, ogni giorno, anche se nessuno apre GRIP: una palestra
// chiusa la domenica non deve saltare un giorno. Lo lancia un Railway Cron (docs/deploy.md), o
// lo si lancia a mano:  npm run giro
//
// Non invia niente: messaggi, email e notifiche sono un'altra parte, che arriverà spenta. Ogni
// passo è idempotente — lanciato due volte nello stesso giorno, la seconda non trova nulla da
// fare — così un cron ripetuto o un lancio a mano in più non fanno danni.
//
// Oggi fa una cosa: chiude come *non raggiungibili* i lead con troppi tentativi senza risposta,
// l'ultimo da tanto. Prima lo faceva GET /api/lead/lavoro alla lettura: una GET non deve scrivere.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { organizations, trattative, attivita } from './db/schema/index.js';
import { soglieDi } from '../../shared/soglie.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const AUTORE_SISTEMA = 'Sistema';

/** Chiude i lead non raggiungibili, con una riga di diario ciascuno. → quanti ne ha chiusi */
async function chiudiNonRaggiungibili(conn, oggi, soglie) {
	const limite = spostaGiorni(oggi, -soglie.nonRaggiungibileGiorni);
	return conn.transaction(async (tx) => {
		const chiusi = await tx.update(trattative)
			.set({ stato: 'non_raggiungibile', statoDal: oggi, updatedDate: new Date() })
			.where(and(
				eq(trattative.stato, 'in_attesa'),
				gte(trattative.tentativiSenzaRisposta, soglie.tentativiMassimi),
				lte(trattative.ultimoContattoIl, limite),
			))
			.returning({ id: trattative.id, personaId: trattative.personaId, tentativi: trattative.tentativiSenzaRisposta });
		if (chiusi.length) {
			await tx.insert(attivita).values(chiusi.map((t) => ({
				personaId: t.personaId, trattativaId: t.id, tipo: 'stato_automatico', esito: 'non_raggiungibile', autoreNome: AUTORE_SISTEMA,
				nota: `${t.tentativi} tentativi senza risposta, l'ultimo da almeno ${soglie.nonRaggiungibileGiorni} giorni`,
			})));
		}
		return chiusi.length;
	});
}

/**
 * Un giro su tutte le palestre. → [{ palestra, non_raggiungibili }]
 *
 * ponytail: oggi c'è una palestra per installazione e le trattative non hanno ancora la loro
 * palestra: il giro scorre le palestre, ma ogni passo lavora sul database intero. Con il
 * multi-tenant ogni passo riceverà la palestra e filtrerà per lei.
 */
export async function giro({ oggi = oggiIso(), conn = db } = {}) {
	const palestre = await conn.select({ nome: organizations.nome, impostazioni: organizations.impostazioni }).from(organizations);
	const esiti = [];
	for (const palestra of palestre) {
		const soglie = soglieDi(palestra.impostazioni);
		esiti.push({ palestra: palestra.nome, non_raggiungibili: await chiudiNonRaggiungibili(conn, oggi, soglie.lead) });
	}
	return esiti;
}

// Lanciato da riga di comando (non importato dai test): un giro, il resoconto, e l'uscita.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		for (const e of await giro()) console.log(`${e.palestra}: ${e.non_raggiungibili} lead chiusi come non raggiungibili.`);
		await pool.end();
		process.exit(0);
	} catch (errore) {
		console.error('Giro fallito:', errore.message);
		await pool.end().catch(() => {});
		process.exit(1);
	}
}
