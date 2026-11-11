// Gli avvisi di Da fare, salvati: la tabella `avvisi` tenuta allineata al motore dei segnali.
//
// Le regole sono funzioni pure (shared/daFare.js): quali avvisi ha una persona oggi, con che
// esito si chiude uno che non è più vero, in che ordine si mostrano. Qui si tiene la tabella al
// passo: si aprono gli avvisi nuovi, si riaprono quelli chiusi da soli che sono tornati veri, si
// chiudono quelli che non lo sono più. Lo fanno GET /api/avvisi prima di leggere (routes/avvisi.js),
// la dashboard e il giro notturno (giro.js), così le chiusure automatiche finiscono in Archivio
// anche se nessuno apre Da fare.
//
// Tutto sotto un lock legato alla transazione, come il diario del giro: due allineamenti insieme
// (una lettura e il giro, due schede aperte) non scrivono due volte la stessa cosa.
//
// ponytail: si allinea a ogni lettura; a questa scala costa poco. Se peserà, solo nel giro.
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql, count } from 'drizzle-orm';
import { db } from '../db/client.js';
import { avvisi, persone, members, attivita } from '../db/schema/index.js';
import { avvisiDi, esitoChiusura, esitoAManoValido, ordina, ESITI, TIPI_AVVISO } from '../../../shared/daFare.js';
import { oggiIso, giorniFra } from '../../../shared/giorni.js';
import { SOGLIE } from '../../../shared/soglie.js';

/** Quanti avvisi chiusi mostra l'Archivio, dal più recente. */
export const ARCHIVIO_MASSIMO = 200;
const A_MANO = ESITI.filter((e) => e.aMano).map((e) => e.valore);
const TIPI = TIPI_AVVISO.map((t) => t.valore);
const BLOCCHI = 500;

/** Un errore di chi chiede (404, 400): la rotta lo manda così com'è (routes/errorHandler.js). */
function errore(statusCode, messaggio) {
	return Object.assign(new Error(messaggio), { statusCode });
}

/**
 * I tipi che la palestra non segue: quelli con tutti i segnali spenti nelle Regole. Non si
 * calcolano e non si mostrano; le loro righe aperte restano dove sono, e ricompaiono se li si
 * riaccende.
 */
export function tipiSpenti(soglie = SOGLIE) {
	const spenti = new Set(soglie.segnaliSpenti ?? []);
	return new Set(TIPI_AVVISO.filter((t) => t.segnali.every((s) => spenti.has(s))).map((t) => t.valore));
}

async function sottoBlocco(conn, lavoro) {
	return conn.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dafare:avvisi'))`);
		return lavoro(tx);
	});
}

// Lo stesso oggetto scritto con le chiavi in un altro ordine (jsonb le riordina): uguale.
const canonico = (v) => (v && typeof v === 'object' && !Array.isArray(v)
	? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])]))
	: Array.isArray(v) ? v.map(canonico) : v);
const uguali = (a, b) => JSON.stringify(canonico(a ?? null)) === JSON.stringify(canonico(b ?? null));

// Un avviso aperto si riconosce dall'occorrenza; quello della frequenza dal tipo e dalla persona,
// perché la sua chiave è il giorno in cui è comparso, e domani il motore lo vede con la chiave di domani.
const occorrenza = (personaId, tipo, chiave) => (tipo === 'frequenza' ? `${personaId}|frequenza` : `${personaId}|${tipo}|${chiave}`);

/**
 * Tiene la tabella al passo con il motore.
 *
 * 1. Calcola gli avvisi di oggi (`avvisiDi`) per ogni socio di `persone`.
 * 2. Apre quelli che non hanno una riga.
 * 3. Riapre quelli chiusi da soli che sono tornati veri (le chiusure a mano non si riaprono:
 *    un «Nascosto» torna solo con Ripristina).
 * 4. Chiude le righe aperte che non sono più vere, con l'esito di `esitoChiusura`.
 * 5. La Frequenza non apre una riga nuova se l'ultima chiusura a mano (Contattato, Nascosto) è più
 *    recente di `frequenzaRiapriGiorni`. Un calo nuovo è un'occorrenza nuova: chiave di oggi.
 *
 * @param persone tutte le persone di `situazioni()` (lib/segnali.js), con `segnali` e `grezzi`:
 *                una riga aperta di una persona che non c'è si chiude
 * @returns {{ aperti, riaperti, chiusi }}
 */
export async function allinea(conn = db, persone = [], oggi = oggiIso(), soglie = SOGLIE) {
	const spenti = tipiSpenti(soglie);
	const riapriDopo = soglie.frequenzaRiapriGiorni ?? SOGLIE.frequenzaRiapriGiorni;
	const veri = [];
	const grezziDi = new Map();
	for (const p of persone) {
		grezziDi.set(p.persona_id, p.grezzi ?? {});
		if (!p.socio_id) continue;
		for (const a of avvisiDi(p, oggi, soglie)) {
			if (!spenti.has(a.tipo)) veri.push({ personaId: p.persona_id, ...a });
		}
	}

	return sottoBlocco(conn, async (tx) => {
		// Dal più nuovo: se una persona avesse due righe aperte della frequenza, vale la più recente.
		const aperte = await tx.select().from(avvisi).where(isNull(avvisi.chiusoIl)).orderBy(desc(avvisi.apertoIl));
		const apertaDi = new Map();
		for (const r of aperte) {
			const k = occorrenza(r.personaId, r.tipo, r.chiave);
			if (!apertaDi.has(k)) apertaDi.set(k, r);
		}

		const ancoraVere = new Set();
		const daAggiornare = [];
		const senzaRiga = [];
		for (const v of veri) {
			const r = apertaDi.get(occorrenza(v.personaId, v.tipo, v.chiave));
			if (r && !ancoraVere.has(r.id)) {
				ancoraVere.add(r.id);
				// L'istantanea segue l'avviso finché è aperto (la frequenza cambia ogni giorno).
				if (!uguali(r.dati, v.dati)) daAggiornare.push({ id: r.id, dati: v.dati });
			} else if (!r) senzaRiga.push(v);
		}

		// Le righe già chiuse di quelle occorrenze, e l'ultima chiusura a mano della frequenza.
		const chiuse = new Map();
		if (senzaRiga.length) {
			const chiavi = JSON.stringify(senzaRiga.map((v) => ({ persona_id: v.personaId, tipo: v.tipo, chiave: v.chiave })));
			const righe = await tx.execute(sql`
				select a.id, a.persona_id, a.tipo, a.chiave, a.esito
				from ${avvisi} a
				join jsonb_to_recordset(${chiavi}::jsonb) as k(persona_id uuid, tipo text, chiave text)
					on a.persona_id = k.persona_id and a.tipo = k.tipo and a.chiave = k.chiave`);
			for (const r of righe.rows ?? righe) chiuse.set(`${r.persona_id}|${r.tipo}|${r.chiave}`, r);
		}
		const conCalo = senzaRiga.filter((v) => v.tipo === 'frequenza').map((v) => v.personaId);
		const ultimaAMano = new Map();
		if (conCalo.length) {
			const righe = await tx.select({ personaId: avvisi.personaId, il: sql`max(${avvisi.chiusoIl})` })
				.from(avvisi)
				.where(and(eq(avvisi.tipo, 'frequenza'), inArray(avvisi.personaId, conCalo), inArray(avvisi.esito, A_MANO)))
				.groupBy(avvisi.personaId);
			for (const r of righe) ultimaAMano.set(r.personaId, oggiIso(new Date(r.il)));
		}

		const nuovi = [];
		const daRiaprire = [];
		for (const v of senzaRiga) {
			if (v.tipo === 'frequenza') {
				const il = ultimaAMano.get(v.personaId);
				if (il && giorniFra(il, oggi) < riapriDopo) continue;
			}
			const r = chiuse.get(`${v.personaId}|${v.tipo}|${v.chiave}`);
			if (!r) nuovi.push(v);
			else if (!A_MANO.includes(r.esito)) daRiaprire.push({ id: r.id, dati: v.dati });
		}

		// Chiuse da sole: quelle aperte che il motore non vede più (i tipi spenti restano come sono).
		const perEsito = new Map();
		for (const r of aperte) {
			if (ancoraVere.has(r.id) || spenti.has(r.tipo)) continue;
			const esito = esitoChiusura({ tipo: r.tipo, chiave: r.chiave, dati: r.dati ?? {}, aperto_il: r.apertoIl }, grezziDi.get(r.personaId) ?? {}, oggi, soglie);
			if (!perEsito.has(esito)) perEsito.set(esito, []);
			perEsito.get(esito).push(r.id);
		}

		for (let i = 0; i < nuovi.length; i += BLOCCHI) {
			await tx.insert(avvisi).values(nuovi.slice(i, i + BLOCCHI).map((v) => ({ personaId: v.personaId, tipo: v.tipo, chiave: v.chiave, dati: v.dati })))
				.onConflictDoNothing();
		}
		if (daRiaprire.length) {
			await tx.execute(sql`
				update ${avvisi} a set chiuso_il = null, esito = null, autore_id = null, autore_nome = null, dati = k.dati
				from jsonb_to_recordset(${JSON.stringify(daRiaprire)}::jsonb) as k(id uuid, dati jsonb)
				where a.id = k.id`);
		}
		if (daAggiornare.length) {
			await tx.execute(sql`
				update ${avvisi} a set dati = k.dati
				from jsonb_to_recordset(${JSON.stringify(daAggiornare)}::jsonb) as k(id uuid, dati jsonb)
				where a.id = k.id`);
		}
		let chiusi = 0;
		for (const [esito, ids] of perEsito) {
			await tx.update(avvisi).set({ chiusoIl: new Date(), esito, autoreId: null, autoreNome: null })
				.where(and(inArray(avvisi.id, ids), isNull(avvisi.chiusoIl)));
			chiusi += ids.length;
		}
		return { aperti: nuovi.length, riaperti: daRiaprire.length, chiusi };
	});
}

// Un avviso come lo riceve Da fare: con il socio e i suoi recapiti.
const COLONNE = {
	id: avvisi.id, tipo: avvisi.tipo, chiave: avvisi.chiave, persona_id: avvisi.personaId,
	socio_id: members.id, nome: persone.fullName, codice_socio: members.codiceSocio, telefono: persone.telefono, email: persone.email,
	dati: avvisi.dati, aperto_il: avvisi.apertoIl, chiuso_il: avvisi.chiusoIl, esito: avvisi.esito, autore_nome: avvisi.autoreNome,
};
const conIlSocio = (conn) => conn.select(COLONNE).from(avvisi)
	.innerJoin(persone, eq(persone.id, avvisi.personaId))
	.leftJoin(members, eq(members.personaId, avvisi.personaId));

async function contaPerTipo(conn, chiusi) {
	const righe = await conn.select({ tipo: avvisi.tipo, quanti: count() }).from(avvisi)
		.where(chiusi ? isNotNull(avvisi.chiusoIl) : isNull(avvisi.chiusoIl)).groupBy(avvisi.tipo);
	const conti = Object.fromEntries(TIPI.map((t) => [t, 0]));
	for (const r of righe) if (r.tipo in conti) conti[r.tipo] = Number(r.quanti);
	return conti;
}

/** Gli avvisi aperti per tipo, come li conta la barra di Da fare: i tipi spenti valgono zero. */
export async function conteggi({ conn = db, soglie = SOGLIE } = {}) {
	const conti = await contaPerTipo(conn, false);
	for (const t of tipiSpenti(soglie)) conti[t] = 0;
	return conti;
}

/**
 * Gli avvisi da mostrare.
 * - `aperti`: quelli aperti dei tipi seguiti, nell'ordine dell'urgenza di ogni scheda (`ordina`).
 * - `archivio`: i chiusi, gli ultimi ARCHIVIO_MASSIMO per data di chiusura, dal più recente; con
 *   `archiviati`, quanti chiusi ci sono per tipo (la seconda fila dell'Archivio).
 *
 * @returns {{ conteggi, avvisi, archiviati? }}
 */
export async function leggi({ vista = 'aperti', tipo = null, conn = db, soglie = SOGLIE } = {}) {
	const spenti = tipiSpenti(soglie);
	const conti = await conteggi({ conn, soglie });
	if (vista === 'archivio') {
		const righe = await conIlSocio(conn)
			.where(and(isNotNull(avvisi.chiusoIl), tipo ? eq(avvisi.tipo, tipo) : undefined))
			.orderBy(desc(avvisi.chiusoIl), desc(avvisi.id)).limit(ARCHIVIO_MASSIMO);
		return { conteggi: conti, archiviati: await contaPerTipo(conn, true), avvisi: righe };
	}
	const seguiti = (tipo ? [tipo] : TIPI).filter((t) => !spenti.has(t));
	const righe = seguiti.length
		? await conIlSocio(conn).where(and(isNull(avvisi.chiusoIl), inArray(avvisi.tipo, seguiti)))
		: [];
	return { conteggi: conti, avvisi: seguiti.flatMap((t) => ordina(righe.filter((r) => r.tipo === t), t)) };
}

async function avvisoPerId(conn, id) {
	const [riga] = await conIlSocio(conn).where(eq(avvisi.id, id)).limit(1);
	return riga ?? null;
}

/**
 * Chiude a mano un avviso aperto: Nascosto, Contattato (la frequenza), Auguri fatti (i compleanni).
 * Contattato e Auguri fatti scrivono anche un contatto nel diario, con i segnali e l'avviso: così
 * il giro continua a contare chi, contattato perché non veniva, poi è tornato (giro.js).
 *
 * @param utente { id, nome } chi lo chiude
 * @returns l'avviso chiuso
 */
export async function chiudi(id, esito, utente, conn = db) {
	return sottoBlocco(conn, async (tx) => {
		const [r] = await tx.select().from(avvisi).where(eq(avvisi.id, id)).limit(1);
		if (!r) throw errore(404, 'Avviso non trovato.');
		if (r.chiusoIl) throw errore(400, 'Questo avviso è già chiuso: ricarica la pagina.');
		if (!esitoAManoValido(esito, r.tipo)) throw errore(400, 'Questo avviso non si chiude così.');
		await tx.update(avvisi).set({ chiusoIl: new Date(), esito, autoreId: utente.id, autoreNome: utente.nome }).where(eq(avvisi.id, id));
		if (esito === 'contattato' || esito === 'auguri_fatti') {
			const segnali = r.tipo === 'frequenza' ? [r.dati?.segnale ?? 'assente'] : ['compleanno'];
			await tx.insert(attivita).values({
				personaId: r.personaId, tipo: 'contatto', esito: 'fatto', autoreId: utente.id, autoreNome: utente.nome,
				riferimento: { segnali, avviso: r.id },
			});
		}
		return avvisoPerId(tx, id);
	});
}

/**
 * Rimette nella sua scheda un avviso nascosto (P6). Le altre chiusure a mano non si annullano, e
 * quelle automatiche si riaprono da sole se l'avviso torna vero. Se non è più vero, il prossimo
 * allineamento lo richiude con il suo esito.
 *
 * @returns l'avviso riaperto
 */
export async function ripristina(id, conn = db) {
	return sottoBlocco(conn, async (tx) => {
		const [r] = await tx.select().from(avvisi).where(eq(avvisi.id, id)).limit(1);
		if (!r) throw errore(404, 'Avviso non trovato.');
		if (r.chiusoIl === null || r.esito !== 'nascosto') throw errore(400, 'Si ripristina solo un avviso nascosto.');
		if (r.tipo === 'frequenza') {
			const [aperto] = await tx.select({ id: avvisi.id }).from(avvisi)
				.where(and(eq(avvisi.personaId, r.personaId), eq(avvisi.tipo, 'frequenza'), isNull(avvisi.chiusoIl), ne(avvisi.id, id))).limit(1);
			if (aperto) throw errore(400, 'Questo socio ha già un avviso aperto sulla frequenza.');
		}
		await tx.update(avvisi).set({ chiusoIl: null, esito: null, autoreId: null, autoreNome: null }).where(eq(avvisi.id, id));
		return avvisoPerId(tx, id);
	});
}
