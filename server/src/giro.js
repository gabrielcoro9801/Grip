// Il giro quotidiano di manutenzione.
//
// Le cose che il CRM deve fare da solo, ogni giorno, anche se nessuno apre GRIP: una palestra
// chiusa la domenica non deve saltare un giorno. Lo lancia un Railway Cron (docs/deploy.md), o
// lo si lancia a mano:  npm run giro
//
// Ogni passo è idempotente — lanciato due volte nello stesso giorno, la seconda non trova nulla
// da fare — così un cron ripetuto o un lancio a mano in più non fanno danni.
//
// Cosa fa: registra chi è rientrato in palestra dopo essere stato contattato perché assente;
// archivia chi è senza abbonamento da troppo tempo; e scrive nel diario dei soci le cose da fare
// che sono comparse e quelle che non ci sono più, così la scheda le racconta senza mostrarle;
// infine allinea gli avvisi di Da fare (lib/avvisi.js), così quelli che si chiudono da soli
// finiscono in Archivio anche se nessuno apre Da fare. E mette in regola le liste d'attesa delle
// lezioni future (lib/prenotazioni.js, `regolaOfferte`): un'offerta scaduta passa al successivo
// anche se nessuno apre il portale.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { organizations, attivita, members, bookings, sessions } from './db/schema/index.js';
import { regolaOfferte } from './lib/prenotazioni.js';
import { soglieDi } from '../../shared/soglie.js';
import { situazioni } from './lib/segnali.js';
import { allinea } from './lib/avvisi.js';
import { etichettaSegnale } from '../../shared/segnali.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const AUTORE_SISTEMA = 'Sistema';

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
 * Archivia i soci senza abbonamento da `archiviazioneGiorni` (0 = mai): dall'ultima scadenza, o
 * dall'iscrizione per chi non ne ha mai avuto uno. Una riga di diario ciascuno; riattivarlo è il
 * solito "Riattiva".
 * Idempotente: un archiviato non si riarchivia. → quanti ne ha archiviati
 */
async function archiviaSenzaAbbonamento(conn, oggi, soglie, persone) {
	const giorni = soglie.segnali.archiviazioneGiorni;
	if (!giorni) return 0;
	const limite = spostaGiorni(oggi, -giorni);
	const daArchiviare = persone.filter((p) => p.socio_id && p.fase === 'senza_abbonamento'
		&& (p.ultima_fine ?? p.iscritto_il) && (p.ultima_fine ?? p.iscritto_il) <= limite);
	if (!daArchiviare.length) return 0;
	return conn.transaction(async (tx) => {
		const fatti = await tx.update(members).set({ archiviatoIl: oggi, updatedDate: new Date() })
			.where(and(inArray(members.id, daArchiviare.map((p) => p.socio_id)), isNull(members.archiviatoIl)))
			.returning({ id: members.id, personaId: members.personaId });
		if (fatti.length) {
			await tx.insert(attivita).values(fatti.map((m) => ({
				personaId: m.personaId, tipo: 'archiviazione_automatica', autoreNome: AUTORE_SISTEMA,
				nota: `Senza abbonamento da almeno ${giorni} giorni`,
			})));
		}
		return fatti.length;
	});
}

/**
 * Il diario delle cose da fare dei soci: una riga quando un segnale compare ("Da fare: Abbonamento
 * in scadenza — scade tra 14 giorni"), una quando non c'è più (rinnovato,
 * tornato in palestra). Un segnale "fatto" e nascosto per qualche giorno c'è ancora: non si
 * chiude. Quelli spenti dalla palestra non si scrivono né si chiudono.
 *
 * ponytail: un giro al giorno, quindi l'ora della riga è quella del giro; se servirà l'istante,
 * lo stesso confronto per una persona dopo un'iscrizione.
 */
async function scriviDaFare(conn, soglie, persone) {
	const soci = persone.filter((p) => p.socio_id);
	if (!soci.length) return { aperti: 0, chiusi: 0 };
	const spenti = new Set(soglie.segnaliSpenti ?? []);
	// Due giri insieme (quello pianificato e uno lanciato a mano) leggevano lo stesso diario e
	// scrivevano due volte la stessa riga: il lock fa aspettare il secondo, che poi trova le righe
	// del primo. È legato alla transazione, e si libera da solo.
	return conn.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('giro:da-fare'))`);
		const righe = await tx.select({ personaId: attivita.personaId, tipo: attivita.tipo, codice: attivita.esito })
			.from(attivita).where(inArray(attivita.tipo, ['segnale_aperto', 'segnale_chiuso']))
			.orderBy(attivita.createdDate, attivita.id);
		const aperti = new Map();
		for (const r of righe) {
			if (!aperti.has(r.personaId)) aperti.set(r.personaId, new Set());
			if (r.tipo === 'segnale_aperto') aperti.get(r.personaId).add(r.codice);
			else aperti.get(r.personaId).delete(r.codice);
		}
		const nuove = [];
		let nAperti = 0; let nChiusi = 0;
		for (const p of soci) {
			const ora = new Map(p.segnali.filter((s) => s.pubblico === 'staff').map((s) => [s.codice, s]));
			const prima = aperti.get(p.persona_id) ?? new Set();
			for (const [codice, s] of ora) {
				if (prima.has(codice)) continue;
				nuove.push({ personaId: p.persona_id, tipo: 'segnale_aperto', esito: codice, nota: `${s.titolo} — ${s.motivo}`, autoreNome: AUTORE_SISTEMA });
				nAperti += 1;
			}
			for (const codice of prima) {
				if (ora.has(codice) || spenti.has(codice)) continue;
				nuove.push({ personaId: p.persona_id, tipo: 'segnale_chiuso', esito: codice, nota: etichettaSegnale(codice), autoreNome: AUTORE_SISTEMA });
				nChiusi += 1;
			}
		}
		// A blocchi: il primo giro su una palestra già avviata scrive una riga per ogni cosa da fare.
		for (let i = 0; i < nuove.length; i += 500) await tx.insert(attivita).values(nuove.slice(i, i + 500));
		return { aperti: nAperti, chiusi: nChiusi };
	});
}

/** Le liste d'attesa delle lezioni da oggi in poi, messe in regola. → quante lezioni ha guardato */
async function regolaListeAttesa(conn, oggi, adesso) {
	const lezioni = await conn.selectDistinct({ id: bookings.sessionId }).from(bookings)
		.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
		.where(and(eq(bookings.status, 'waitlisted'), gte(sessions.date, oggi), eq(sessions.status, 'active')));
	for (const l of lezioni) await conn.transaction((tx) => regolaOfferte(tx, l.id, adesso));
	return lezioni.length;
}

/**
 * Un giro su tutte le palestre. → [{ palestra, rientri, archiviati, da_fare, avvisi }]
 *
 * ponytail: oggi c'è una palestra per installazione: il giro scorre le palestre, ma ogni passo lavora sul database intero. Con il
 * multi-tenant ogni passo riceverà la palestra e filtrerà per lei.
 */
export async function giro({ oggi = oggiIso(), conn = db, adesso = new Date() } = {}) {
	const palestre = await conn.select({ nome: organizations.nome, impostazioni: organizations.impostazioni }).from(organizations);
	const esiti = [];
	for (const palestra of palestre) {
		const soglie = soglieDi(palestra.impostazioni);
		const rientri = await registraRientri(conn, adesso);
		const archiviati = await archiviaSenzaAbbonamento(conn, oggi, soglie, (await situazioni({ conn, adesso })).persone);
		// Dopo l'archiviazione: chi è appena stato archiviato chiude le sue cose da fare e i suoi avvisi.
		const { persone } = await situazioni({ conn, adesso });
		esiti.push({
			palestra: palestra.nome, rientri, archiviati,
			da_fare: await scriviDaFare(conn, soglie, persone),
			avvisi: await allinea(conn, persone, oggi, soglie),
			liste_attesa: await regolaListeAttesa(conn, oggi, adesso),
		});
	}
	return esiti;
}

// Lanciato da riga di comando (non importato dai test): un giro, il resoconto, e l'uscita.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		for (const e of await giro()) {
			console.log(`${e.palestra}: ${e.rientri} soci rientrati dopo un contatto, ${e.archiviati} archiviati senza abbonamento.`);
			console.log(`  Da fare nel diario: ${e.da_fare.aperti} comparsi, ${e.da_fare.chiusi} non più da fare.`);
			console.log(`  Avvisi: ${e.avvisi.aperti} aperti, ${e.avvisi.riaperti} riaperti, ${e.avvisi.chiusi} chiusi da soli.`);
			console.log(`  Liste d'attesa guardate: ${e.liste_attesa}.`);
		}
		await pool.end();
		process.exit(0);
	} catch (errore) {
		console.error('Giro fallito:', errore.message);
		await pool.end().catch(() => {});
		process.exit(1);
	}
}
