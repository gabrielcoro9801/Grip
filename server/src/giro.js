// Il giro quotidiano di manutenzione.
//
// Le cose che il CRM deve fare da solo, ogni giorno, anche se nessuno apre GRIP: una palestra
// chiusa la domenica non deve saltare un giorno. Lo lancia un Railway Cron (docs/deploy.md), o
// lo si lancia a mano:  npm run giro
//
// Due parti. La **manutenzione** non invia niente ed è sempre attiva. Gli **invii** (i playbook
// delle comunicazioni, lib/invii.js) stanno dietro tre serrature e al primo deploy sono spenti:
// senza INVII_REALI, senza l'interruttore della palestra, senza un canale verificato e un
// playbook attivo non parte niente; un playbook in anteprima scrive solo messaggi `simulato`.
// Ogni passo è idempotente — lanciato due volte nello stesso giorno, la seconda non trova nulla
// da fare — così un cron ripetuto o un lancio a mano in più non fanno danni.
//
// Oggi fa due cose: chiude come *non raggiungibili* i lead con troppi tentativi senza risposta,
// l'ultimo da tanto (prima lo faceva GET /api/lead/lavoro alla lettura: una GET non deve
// scrivere); e registra chi è rientrato in palestra dopo essere stato contattato perché assente.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { organizations, trattative, attivita } from './db/schema/index.js';
import { soglieDi } from '../../shared/soglie.js';
import { giroInvii } from './lib/invii.js';
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

// Entro quanti giorni da un contatto un ingresso conta come "è tornato".
const GIORNI_RIENTRO = 14;
// Di quanto si guarda indietro: un giro saltato per qualche giorno non perde i rientri.
const GIORNI_RECUPERO = 30;

/**
 * Chi, contattato perché assente o in calo, è rientrato entro 14 giorni: una riga
 * `ingresso_dopo_contatto` nel diario, con il contatto e il primo ingresso dopo. È la base di
 * "dei 40 soci contattati, 26 sono tornati" (Fase 5). Una riga per contatto (indice unico):
 * rilanciato, il giro non ne crea altre. → quante ne ha scritte
 */
async function registraRientri(conn, adesso) {
	const righe = await conn.execute(sql`
		insert into attivita (persona_id, tipo, esito, autore_nome, riferimento, created_date)
		select c.persona_id, 'ingresso_dopo_contatto',
			((i.entrato_alle at time zone 'Europe/Rome')::date - (c.created_date at time zone 'Europe/Rome')::date)::text,
			${AUTORE_SISTEMA}, jsonb_build_object('contatto', c.id, 'ingresso', i.id), i.entrato_alle
		from attivita c
		join members m on m.persona_id = c.persona_id
		cross join lateral (
			select id, entrato_alle from ingressi
			where member_id = m.id and entrato_alle > c.created_date and entrato_alle <= c.created_date + make_interval(days => ${GIORNI_RIENTRO})
			order by entrato_alle limit 1
		) i
		where c.tipo = 'contatto'
			and c.riferimento->'segnali' ?| array['assente', 'in_calo']
			and c.created_date >= ${adesso}::timestamptz - make_interval(days => ${GIORNI_RECUPERO})
		on conflict do nothing
		returning id`);
	return righe.rows?.length ?? righe.length ?? 0;
}

/**
 * Un giro su tutte le palestre. → [{ palestra, non_raggiungibili, rientri, invii }]
 *
 * ponytail: oggi c'è una palestra per installazione e le trattative non hanno ancora la loro
 * palestra: il giro scorre le palestre, ma ogni passo lavora sul database intero. Con il
 * multi-tenant ogni passo riceverà la palestra e filtrerà per lei.
 */
export async function giro({ oggi = oggiIso(), conn = db, adesso = new Date(), adattatori } = {}) {
	const palestre = await conn.select({ nome: organizations.nome, impostazioni: organizations.impostazioni }).from(organizations);
	const esiti = [];
	for (const palestra of palestre) {
		const soglie = soglieDi(palestra.impostazioni);
		esiti.push({
			palestra: palestra.nome,
			non_raggiungibili: await chiudiNonRaggiungibili(conn, oggi, soglie.lead),
			rientri: await registraRientri(conn, adesso),
			// Dopo la manutenzione: i rientri appena scritti non cambiano chi va contattato, ma i
			// lead chiusi sì, e i segnali si leggono una volta sola, già aggiornati.
			invii: await giroInvii(conn, { adesso, adattatori }),
		});
	}
	return esiti;
}

// Lanciato da riga di comando (non importato dai test): un giro, il resoconto, e l'uscita.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		for (const e of await giro()) {
			console.log(`${e.palestra}: ${e.non_raggiungibili} lead chiusi come non raggiungibili, ${e.rientri} soci rientrati dopo un contatto.`);
			const i = e.invii;
			console.log(i.silenzio
				? '  Comunicazioni: fascia di silenzio, nessun messaggio accodato.'
				: `  Comunicazioni: ${i.simulati} simulati, ${i.accodati} accodati, ${i.bloccati} bloccati; ${i.inviati} inviati, ${i.falliti} non riusciti${i.freno ? ' (raggiunto il massimo per giro)' : ''}.`);
		}
		await pool.end();
		process.exit(0);
	} catch (errore) {
		console.error('Giro fallito:', errore.message);
		await pool.end().catch(() => {});
		process.exit(1);
	}
}
