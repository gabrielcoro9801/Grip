/**
 * Da fare, un caso per ogni avviso e per ogni modo di chiusura: li crea nel database, li porta
 * dove devono andare (le chiusure a mano dalle rotte, quelle automatiche cambiando i dati e
 * allineando), poi controlla con le letture di Da fare che ognuno stia nella scheda o
 * nell'Archivio giusti, con l'esito giusto.
 *
 * I casi (un socio per caso, cognome «DatiDaFare…»):
 * - aperti, uno per scheda: In scadenza, Scaduti, Frequenza, Documenti, Compleanni;
 * - Nascosto (in Archivio), e Nascosto poi Ripristinato (di nuovo nella scheda);
 * - Contattato (Frequenza) e Auguri fatti (Compleanni), a mano;
 * - Rinnovato, Passato in Scaduti (con lo Scaduto che si apre), Documento caricato, Socio
 *   archiviato, Chiuso dopo N giorni (uno Scaduto e un Compleanno), Non più da fare: da soli.
 *
 * Come si usa: cd server && npm run dati:da-fare
 *
 * Funziona su qualunque database: le date seguono le Regole della palestra, gli avvisi spenti si
 * riaccendono solo per il tempo del controllo, e alla fine si cancella tutto quello che ha creato.
 * Per le chiusure a mano entra come reception@grip.local se c'è; se no crea un accesso di prova e
 * lo cancella. Esce con 1 se un caso non è dove deve stare.
 */
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, attivita, organizations, memberDocuments, ingressi, avvisi,
} from '../src/db/schema/index.js';
import { situazioni } from '../src/lib/segnali.js';
import { allinea } from '../src/lib/avvisi.js';
import { soglieEnte } from '../src/lib/impostazioni.js';
import { TIPI_AVVISO, etichettaEsito } from '../../shared/daFare.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
const COGNOME = `DatiDaFare${lettere}`;
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);
const SEGNALI_DA_FARE = TIPI_AVVISO.flatMap((tp) => tp.segnali);

const errori = [];
function controlla(nome, condizione, dettaglio = '') {
	if (!condizione) errori.push(nome);
	console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${!condizione && dettaglio ? ` — ${String(dettaglio).slice(0, 140)}` : ''}`);
}

let app;
const creati = { soci: [], persone: [], account: null };
let palestra = null;
let spentiPrima;

try {
	// --- Le Regole della palestra: le date dei casi le seguono -----------------------------------
	[palestra] = await db.select().from(organizations).limit(1);
	spentiPrima = palestra?.impostazioni?.segnali_spenti;
	if (palestra && Array.isArray(spentiPrima) && spentiPrima.some((c) => SEGNALI_DA_FARE.includes(c))) {
		// Un avviso spento non compare: per il controllo si riaccende, e alla fine si rimette com'era.
		await impostaSpenti(spentiPrima.filter((c) => !SEGNALI_DA_FARE.includes(c)));
	}
	const soglie = await soglieEnte();
	const assenza = soglie.segnali.assenzaGiorni;
	const scadutoGiorni = soglie.scadutoGiorni;
	const dopoCompleanno = soglie.compleannoDopoGiorni;
	// Il 29 febbraio esiste solo negli anni bisestili.
	const nascitaOggi = `1992-${oggi.slice(5)}`;

	// --- I casi --------------------------------------------------------------------------------
	// tipo: la scheda in cui si apre; fine: la fine dell'abbonamento (se non c'è, un Annuale
	// lontano dalla scadenza); ultimo: l'ultimo ingresso, giorni fa (se non c'è, ieri);
	// certificato: la scadenza del certificato medico (se c'è); nascita: la data di nascita.
	const CASI = [
		{ caso: 'in_scadenza_aperto', tipo: 'in_scadenza', fine: fra(1) },
		{ caso: 'scaduto_aperto', tipo: 'scaduto', fine: fra(-1) },
		{ caso: 'frequenza_aperta', tipo: 'frequenza', ultimo: assenza + 5 },
		{ caso: 'documento_aperto', tipo: 'documento', certificato: fra(1) },
		{ caso: 'compleanno_aperto', tipo: 'compleanno', nascita: nascitaOggi },
		{ caso: 'nascosto', tipo: 'scaduto', fine: fra(-1) },
		{ caso: 'ripristinato', tipo: 'scaduto', fine: fra(-1) },
		{ caso: 'contattato', tipo: 'frequenza', ultimo: assenza + 5 },
		{ caso: 'auguri_fatti', tipo: 'compleanno', nascita: nascitaOggi },
		{ caso: 'rinnovato', tipo: 'in_scadenza', fine: fra(1) },
		{ caso: 'passato_in_scaduti', tipo: 'in_scadenza', fine: fra(1) },
		{ caso: 'documento_caricato', tipo: 'documento', certificato: fra(-1) },
		{ caso: 'socio_archiviato', tipo: 'in_scadenza', fine: fra(1) },
		{ caso: 'scaduto_chiuso_dopo_giorni', tipo: 'scaduto', fine: fra(-1) },
		{ caso: 'compleanno_chiuso_dopo_giorni', tipo: 'compleanno', nascita: nascitaOggi },
		{ caso: 'non_piu_da_fare', tipo: 'frequenza', ultimo: assenza + 5 },
	];
	const soci = await db.insert(members).values(CASI.map((c, i) => ({
		nome: c.caso.replace(/_/g, ' '), cognome: COGNOME, codiceSocio: `DDF${String(i).padStart(2, '0')}${lettere}`,
		email: `dati.da.fare.${i}.${t}@test.local`, phone: `+3934${String(t).slice(-7)}${String(i).padStart(2, '0')}`.slice(0, 15),
		dateOfBirth: c.nascita ?? null,
	}))).returning();
	soci.forEach((s, i) => { CASI[i].socio = s; creati.soci.push(s.id); creati.persone.push(s.personaId); });
	const di = (caso) => CASI.find((c) => c.caso === caso);

	const abbonamenti = await db.insert(subscriptions).values(CASI.map((c) => (c.fine
		? { memberId: c.socio.id, planName: 'Mensile', startDate: spostaGiorni(c.fine, -30), endDate: c.fine }
		: { memberId: c.socio.id, planName: 'Annuale', startDate: fra(-200), endDate: fra(300) }))).returning();
	abbonamenti.forEach((a, i) => { CASI[i].abbonamento = a; });
	const certificati = await db.insert(memberDocuments).values(CASI.filter((c) => c.certificato).map((c) => ({
		memberId: c.socio.id, documentType: 'certificato_medico', expiryDate: c.certificato, fileName: 'certificato.pdf',
	}))).returning();
	// Tutti entrano ieri, tranne chi deve mancare da più dei giorni dell'assenza: la Frequenza resta
	// solo dei suoi casi.
	await db.insert(ingressi).values(CASI.map((c) => ({
		memberId: c.socio.id, entratoAlle: new Date(`${fra(-(c.ultimo ?? 1))}T10:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Dati Da fare',
	})));

	// --- Chi chiude a mano ---------------------------------------------------------------------
	app = buildApp({ logger: false });
	await app.ready();
	const entra = async (email, password) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
		return res.statusCode === 200 ? res.json().token : null;
	};
	let token = await entra('reception@grip.local', 'reception1234');
	if (!token) {
		const password = `dati-da-fare-${t}`;
		const [account] = await db.insert(staffAccounts).values({
			nome: 'Reception Dati Da fare', email: `dati.da.fare.${t}@test.local`, passwordHash: await bcrypt.hash(password, 4), ruolo: 'reception',
		}).returning();
		creati.account = account.id;
		token = await entra(account.email, password);
	}
	const come = async (method, url, payload) => {
		const res = await app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
		if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
		return res.json();
	};
	const allineaOra = async () => {
		const s = await situazioni();
		return allinea(db, s.persone, s.oggi, s.soglie);
	};
	const nostri = (righe) => righe.filter((a) => creati.persone.includes(a.persona_id));
	const aperti = async () => nostri((await come('GET', '/api/avvisi')).avvisi);
	const archiviati = async () => {
		const tutti = await Promise.all(TIPI_AVVISO.map((tp) => come('GET', `/api/avvisi?vista=archivio&tipo=${tp.valore}`)));
		return nostri(tutti.flatMap((d) => d.avvisi));
	};
	const apertoDi = (righe, caso, tipo) => righe.find((a) => a.persona_id === di(caso).socio.personaId && a.tipo === tipo);

	// --- 1. Tutti i casi aperti, ognuno nella sua scheda -------------------------------------
	console.log('\nI CASI APERTI');
	await allineaOra();
	const primi = await aperti();
	for (const c of CASI) {
		c.avviso = apertoDi(primi, c.caso, c.tipo);
		const suoi = primi.filter((a) => a.persona_id === c.socio.personaId).map((a) => a.tipo);
		controlla(`${c.caso}: aperto in ${c.tipo}, e solo lì`, c.avviso && suoi.length === 1, JSON.stringify(suoi));
	}
	if (errori.length) throw new Error('i casi non partono come devono: il resto non si controlla');

	// --- 2. Le chiusure ----------------------------------------------------------------------------
	// A mano, dalle rotte di Da fare.
	await come('POST', `/api/avvisi/${di('nascosto').avviso.id}/chiudi`, { esito: 'nascosto' });
	await come('POST', `/api/avvisi/${di('ripristinato').avviso.id}/chiudi`, { esito: 'nascosto' });
	await come('POST', `/api/avvisi/${di('ripristinato').avviso.id}/ripristina`);
	await come('POST', `/api/avvisi/${di('contattato').avviso.id}/chiudi`, { esito: 'contattato' });
	await come('POST', `/api/avvisi/${di('auguri_fatti').avviso.id}/chiudi`, { esito: 'auguri_fatti' });
	// Rinnova: un abbonamento nuovo dal giorno dopo la fine.
	await db.insert(subscriptions).values({ memberId: di('rinnovato').socio.id, planName: 'Mensile', startDate: fra(2), endDate: fra(32) });
	// Carica documento: un certificato nuovo dello stesso tipo.
	certificati.push(...await db.insert(memberDocuments).values({
		memberId: di('documento_caricato').socio.id, documentType: 'certificato_medico', expiryDate: fra(365), fileName: 'certificato-nuovo.pdf',
	}).returning());
	// Non rinnova: «Perché se ne va?» archivia il socio.
	await come('POST', `/api/soci/${di('socio_archiviato').socio.id}/archivia`, { motivo: 'prezzo' });
	// È tornato: un ingresso oggi, e non manca più.
	await db.insert(ingressi).values({ memberId: di('non_piu_da_fare').socio.id, entratoAlle: new Date(), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Dati Da fare' });
	// Il tempo che passa: l'abbonamento e la data dell'avviso spostati indietro insieme.
	const passaIlTempo = async (caso, fine) => {
		const c = di(caso);
		await db.update(subscriptions).set({ startDate: spostaGiorni(fine, -30), endDate: fine }).where(eq(subscriptions.id, c.abbonamento.id));
		await db.update(avvisi).set({ dati: sql`jsonb_set(${avvisi.dati}, '{data}', to_jsonb(${fine}::text))` }).where(eq(avvisi.id, c.avviso.id));
	};
	await passaIlTempo('passato_in_scaduti', fra(-1));
	await passaIlTempo('scaduto_chiuso_dopo_giorni', fra(-(scadutoGiorni + 1)));
	// Il compleanno è passato da più dei giorni delle Regole.
	const passato = fra(-(dopoCompleanno + 1));
	await db.update(members).set({ dateOfBirth: `1992-${passato.slice(5)}` }).where(eq(members.id, di('compleanno_chiuso_dopo_giorni').socio.id));
	await db.update(avvisi).set({ dati: sql`jsonb_set(${avvisi.dati}, '{data}', to_jsonb(${passato}::text))` })
		.where(eq(avvisi.id, di('compleanno_chiuso_dopo_giorni').avviso.id));

	// --- 3. Ogni caso dov'è ------------------------------------------------------------------------
	await allineaOra();
	// Due volte: il secondo allineamento non deve cambiare niente.
	const secondo = await allineaOra();
	const ora = await aperti();
	const archivio = await archiviati();
	const chiusoDi = (caso, tipo) => archivio.find((a) => a.persona_id === di(caso).socio.personaId && a.tipo === tipo);

	console.log('\nNELLE SCHEDE');
	for (const caso of ['in_scadenza_aperto', 'scaduto_aperto', 'frequenza_aperta', 'documento_aperto', 'compleanno_aperto', 'ripristinato']) {
		const { tipo } = di(caso);
		const a = apertoDi(ora, caso, tipo);
		controlla(`${caso}: nella scheda ${tipo}`, a && a.id === di(caso).avviso.id, JSON.stringify(a));
	}
	const scadutoNuovo = apertoDi(ora, 'passato_in_scaduti', 'scaduto');
	controlla('passato_in_scaduti: lo Scaduto aperto, con la chiave dell\'abbonamento', scadutoNuovo?.chiave === String(di('passato_in_scaduti').abbonamento.id), JSON.stringify(scadutoNuovo));

	console.log('\nIN ARCHIVIO');
	const ATTESI = [
		['nascosto', 'scaduto', 'nascosto', true],
		['contattato', 'frequenza', 'contattato', true],
		['auguri_fatti', 'compleanno', 'auguri_fatti', true],
		['rinnovato', 'in_scadenza', 'rinnovato', false],
		['passato_in_scaduti', 'in_scadenza', 'passato_in_scaduti', false],
		['documento_caricato', 'documento', 'documento_caricato', false],
		['socio_archiviato', 'in_scadenza', 'socio_archiviato', false],
		['scaduto_chiuso_dopo_giorni', 'scaduto', 'chiuso_dopo_giorni', false],
		['compleanno_chiuso_dopo_giorni', 'compleanno', 'chiuso_dopo_giorni', false],
		['non_piu_da_fare', 'frequenza', 'non_piu_da_fare', false],
	];
	for (const [caso, tipo, esito, aMano] of ATTESI) {
		const a = chiusoDi(caso, tipo);
		const chi = aMano ? Boolean(a?.autore_nome) : a?.autore_nome === null;
		controlla(`${caso}: in Archivio › ${tipo}, «${etichettaEsito(esito, tipo, soglie)}», ${aMano ? 'con chi l\'ha chiuso' : 'in automatico'}`,
			a && a.id === di(caso).avviso.id && a.esito === esito && a.chiuso_il && chi, JSON.stringify(a && { esito: a.esito, autore: a.autore_nome }));
		controlla(`${caso}: non più nella scheda ${tipo}`, !apertoDi(ora, caso, tipo));
	}
	controlla('Il socio archiviato non ha avvisi aperti', !ora.some((a) => a.persona_id === di('socio_archiviato').socio.personaId));
	controlla('Il ripristinato non è in Archivio', !chiusoDi('ripristinato', 'scaduto'));
	controlla('Un secondo allineamento non cambia niente', secondo.aperti === 0 && secondo.riaperti === 0 && secondo.chiusi === 0, JSON.stringify(secondo));
	// Nessun caso ha più di una riga per occorrenza.
	const righe = await db.select().from(avvisi).where(inArray(avvisi.personaId, creati.persone));
	const occorrenze = righe.map((r) => `${r.personaId}|${r.tipo}|${r.chiave}`);
	controlla('Una riga sola per occorrenza', new Set(occorrenze).size === occorrenze.length);
} catch (errore) {
	controlla('Il controllo arriva in fondo', false, errore.stack ?? errore.message);
} finally {
	if (app) await app.close();
	if (creati.persone.length) {
		await db.delete(avvisi).where(inArray(avvisi.personaId, creati.persone));
		await db.delete(attivita).where(inArray(attivita.personaId, creati.persone));
	}
	if (creati.soci.length) {
		await db.delete(ingressi).where(inArray(ingressi.memberId, creati.soci));
		await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, creati.soci));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, creati.soci));
		await db.delete(members).where(inArray(members.id, creati.soci));
		await db.delete(persone).where(inArray(persone.id, creati.persone));
	}
	if (creati.account) await db.delete(staffAccounts).where(eq(staffAccounts.id, creati.account));
	if (palestra && Array.isArray(spentiPrima)) await impostaSpenti(spentiPrima);
	await pool.end();
}

if (errori.length) {
	console.error(`\nErrore: ${errori.length} ${errori.length === 1 ? 'caso non è' : 'casi non sono'} dove deve stare.`);
	process.exit(1);
}
console.log('\nOgni caso è dove deve stare');

/** I segnali spenti della palestra, toccando solo quella chiave delle impostazioni. */
async function impostaSpenti(spenti) {
	await db.transaction(async (tx) => {
		const [p] = await tx.select().from(organizations).where(eq(organizations.id, palestra.id)).for('update');
		await tx.update(organizations).set({ impostazioni: { ...(p.impostazioni ?? {}), segnali_spenti: spenti } }).where(eq(organizations.id, p.id));
	});
}
