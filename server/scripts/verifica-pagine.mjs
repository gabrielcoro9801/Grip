/**
 * Il giro completo: apre ogni pagina delle due aree e controlla che ci sia quello che deve
 * esserci.
 *
 * Due guasti diversi, e servono controlli diversi:
 *
 *  - **la pagina si rompe** — un componente usato senza importarlo, un errore a runtime. Il
 *    build non se ne accorge, e l'errore salta fuori solo quando quella pagina viene
 *    disegnata. È il difetto che il portale ha già pagato una volta.
 *  - **la pagina si apre vuota** — un campo rinominato e non aggiornato di là. Questo non dà
 *    nessun errore: mostra uno spazio bianco dove c'era un nome. È il rischio di ogni
 *    migrazione verso una nuova API, e l'unico modo di prenderlo è pretendere di **rivedere
 *    dei dati che si sono appena scritti**.
 *
 * Per questo lo script si semina i propri dati — un abbonamento, un documento, un codice
 * d'accesso, un corso prenotato — e poi pretende di ritrovarli sullo schermo.
 *
 * Come si usa:
 *   npm run build            (nella radice)
 *   cd server && npm run verifica:pagine
 */
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, memberDocuments, qrAccessi,
	rooms, courses, categories, events, sessions, bookings,
} from '../src/db/schema/index.js';

const PASSWORD = 'verifica-pagine-1234';
const PORTA = 4600;
const suffisso = Date.now();
const emailStaff = `verifica.pagine.staff.${suffisso}@test.local`;
const emailSocio = `verifica.pagine.socio.${suffisso}@test.local`;

// Quello che il socio deve rivedere: sono i dati seminati qui sotto.
const PIANO = `Piano Verifica ${suffisso}`;
const DOCUMENTO = 'Certificato medico';
const CORSO = `Corso Verifica ${suffisso}`;
// La vista per categorie mostra prima le categorie: il nome del corso si vede entrandoci.
// Quello che si pretende qui e' che i dati dell'agenda siano arrivati e disegnati.
const CATEGORIA = `Categoria Verifica ${suffisso}`;
const NOME_SOCIO = 'Socio Giro Pagine';
const CODICE_SOCIO = '009902';

const PAGINE_STAFF = [
	['/', null], ['/crm', null], ['/crm/abbonamenti', null], ['/crm/iscrizioni', null],
	['/allenamento', null], ['/allenamento/modelli', null], ['/allenamento/assegnate', null],
	['/allenamento/svolti', null],
	['/calendario', null], ['/calendario/prenotazioni', null], ['/calendario/corsi', null],
	['/calendario/sale', null], ['/calendario/istruttori', null], ['/calendario/categorie', null],
	['/admin', null], ['/log-audit', null],
];

// Per il portale il controllo è più severo: ogni pagina deve mostrare un dato preciso.
const PAGINE_SOCIO = [
	['/member-portal', PIANO],
	['/member-portal/corsi', CATEGORIA],
	['/member-portal/allenamento', null],
	['/member-portal/documenti', DOCUMENTO],
	['/member-portal/abbonamento', PIANO],
	['/member-portal/qr', NOME_SOCIO],
	['/member-portal/anagrafica', CODICE_SOCIO],
];

const SCHERMATA_ROTTA = /si è bloccata|Torna all'inizio/i;

const problemi = [];

async function apri(pagina, percorso, atteso, base) {
	const errori = [];
	const ascoltatore = (e) => errori.push(e.message);
	pagina.on('pageerror', ascoltatore);

	await pagina.goto(`${base}${percorso}`, { waitUntil: 'networkidle' });
	await pagina.waitForTimeout(1400);
	const testo = (await pagina.locator('body').innerText()).trim();

	pagina.off('pageerror', ascoltatore);

	const rotta = SCHERMATA_ROTTA.test(testo);
	const vuota = testo.length < 20;
	const manca = atteso && !testo.includes(atteso);
	const ok = errori.length === 0 && !rotta && !vuota && !manca;

	if (!ok) problemi.push({ percorso, errori, rotta, vuota, manca: manca ? atteso : null, testo: testo.slice(0, 200) });

	const motivo = errori[0]
		?? (rotta ? 'ErrorBoundary' : vuota ? 'pagina vuota' : manca ? `manca "${atteso}"` : '');
	console.log(`  ${ok ? 'OK     ' : 'ROTTA  '} ${percorso}${motivo ? ` — ${motivo.slice(0, 90)}` : ''}`);
}

async function entra(pagina, base, percorso, email) {
	await pagina.goto(`${base}${percorso}`, { waitUntil: 'networkidle' });
	await pagina.locator('input[type=email]').first().fill(email);
	await pagina.locator('input[type=password]').first().fill(PASSWORD);
	await pagina.locator('button[type=submit]').first().click();
	await pagina.waitForTimeout(2500);
}

let app;
let browser;
const idAccount = [];
const idAbbonamenti = [];
const idDocumenti = [];
const idQr = [];
const idPrenotazioni = [];
let idSocio;
let idSala;
let idCategoria;
let idCorso;
let idEvento;
let idLezione;

const oggi = new Date().toISOString().split('T')[0];
const fraTreGiorni = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
const fraUnAnno = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];

try {
	const [socio] = await db
		.insert(members)
		.values({ fullName: NOME_SOCIO, email: emailSocio, codiceSocio: CODICE_SOCIO, phone: '333 1234567' })
		.returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Admin Giro Pagine', email: emailStaff, passwordHash, ruolo: 'admin' },
			{ nome: NOME_SOCIO, email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	const abbonamenti = await db
		.insert(subscriptions)
		.values({ memberId: socio.id, planName: PIANO, startDate: oggi, endDate: fraUnAnno, status: 'active', sessionsRemaining: 12 })
		.returning();
	idAbbonamenti.push(...abbonamenti.map((a) => a.id));

	const documenti = await db
		.insert(memberDocuments)
		.values({ memberId: socio.id, documentType: DOCUMENTO, fileName: 'certificato.pdf', expiryDate: fraUnAnno })
		.returning();
	idDocumenti.push(...documenti.map((d) => d.id));

	const qr = await db
		.insert(qrAccessi)
		.values({ clienteId: socio.id, clienteName: NOME_SOCIO, codice: `GRIP-VERI-PAGI-${suffisso}`.slice(0, 60), stato: 'attivo' })
		.returning();
	idQr.push(...qr.map((q) => q.id));

	const [sala] = await db.insert(rooms).values({ name: 'Sala Verifica', capacity: 10 }).returning();
	idSala = sala.id;
	const [categoria] = await db.insert(categories).values({ name: CATEGORIA, color: '#10b981' }).returning();
	idCategoria = categoria.id;
	const [corso] = await db.insert(courses).values({ name: CORSO, categoryId: categoria.id }).returning();
	idCorso = corso.id;
	const [evento] = await db
		.insert(events)
		.values({ courseId: corso.id, roomId: sala.id, capacity: 8, recurrenceType: 'single', startDate: fraTreGiorni, startTime: '18:30', endTime: '19:30' })
		.returning();
	idEvento = evento.id;
	const [lezione] = await db
		.insert(sessions)
		.values({ eventId: evento.id, date: fraTreGiorni, startTime: '18:30', endTime: '19:30', roomId: sala.id, capacity: 8, status: 'active' })
		.returning();
	idLezione = lezione.id;

	const prenotate = await db
		.insert(bookings)
		.values({ sessionId: lezione.id, memberId: socio.id, memberName: NOME_SOCIO, status: 'confirmed' })
		.returning();
	idPrenotazioni.push(...prenotate.map((p) => p.id));

	app = buildApp({ logger: false });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	const BASE = `http://127.0.0.1:${PORTA}`;

	browser = await chromium.launch();

	console.log('\nGESTIONALE');
	const pagStaff = await (await browser.newContext()).newPage();
	await entra(pagStaff, BASE, '/', emailStaff);
	for (const [percorso, atteso] of PAGINE_STAFF) await apri(pagStaff, percorso, atteso, BASE);

	console.log('\nPORTALE SOCI  (con dati seminati: si pretende di rivederli)');
	const pagSocio = await (await browser.newContext()).newPage();
	await entra(pagSocio, BASE, '/member-portal', emailSocio);
	for (const [percorso, atteso] of PAGINE_SOCIO) await apri(pagSocio, percorso, atteso, BASE);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (idPrenotazioni.length) await db.delete(bookings).where(inArray(bookings.id, idPrenotazioni));
	if (idLezione) await db.delete(sessions).where(inArray(sessions.id, [idLezione]));
	if (idEvento) await db.delete(events).where(inArray(events.id, [idEvento]));
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	if (idCategoria) await db.delete(categories).where(inArray(categories.id, [idCategoria]));
	if (idSala) await db.delete(rooms).where(inArray(rooms.id, [idSala]));
	if (idQr.length) await db.delete(qrAccessi).where(inArray(qrAccessi.id, idQr));
	if (idDocumenti.length) await db.delete(memberDocuments).where(inArray(memberDocuments.id, idDocumenti));
	if (idAbbonamenti.length) await db.delete(subscriptions).where(inArray(subscriptions.id, idAbbonamenti));
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await pool.end();
}

const totale = PAGINE_STAFF.length + PAGINE_SOCIO.length;
console.log(`\n${totale - problemi.length}/${totale} pagine si aprono e mostrano quello che devono`);
if (problemi.length) {
	console.log('\nDettaglio:');
	for (const p of problemi) {
		console.log(`\n  ${p.percorso}`);
		for (const e of p.errori) console.log(`    errore: ${e}`);
		if (p.rotta) console.log("    la pagina è caduta nell'ErrorBoundary");
		if (p.vuota) console.log(`    pagina vuota — testo: ${JSON.stringify(p.testo)}`);
		if (p.manca) console.log(`    manca "${p.manca}" — testo: ${JSON.stringify(p.testo)}`);
	}
}
process.exit(problemi.length ? 1 : 0);
