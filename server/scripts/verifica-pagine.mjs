/**
 * Il giro completo: apre ogni pagina delle due aree e raccoglie quello che si rompe.
 *
 * Esiste per una classe di guasto che il progetto ha già pagato una volta: un componente
 * usato senza essere importato non disturba il build — diventa una variabile libera — e
 * l'errore salta fuori solo quando *quella* pagina viene disegnata. Dopo un riassetto che
 * ha spostato un centinaio di file, la domanda "si aprono tutte?" non si risponde a mente.
 *
 * Un fallimento qui è di due tipi: la pagina solleva un errore JavaScript, oppure resta
 * vuota (React ha smontato tutto e l'ErrorBoundary mostra il suo riquadro).
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
import { members, staffAccounts } from '../src/db/schema/index.js';

const PASSWORD = 'verifica-pagine-1234';
const PORTA = 4600;
const suffisso = Date.now();
const emailStaff = `verifica.pagine.staff.${suffisso}@test.local`;
const emailSocio = `verifica.pagine.socio.${suffisso}@test.local`;

const PAGINE_STAFF = [
	'/', '/crm', '/crm/abbonamenti', '/crm/iscrizioni',
	'/allenamento', '/allenamento/modelli', '/allenamento/assegnate', '/allenamento/svolti',
	'/calendario', '/calendario/prenotazioni', '/calendario/corsi',
	'/calendario/sale', '/calendario/istruttori', '/calendario/categorie',
	'/admin', '/log-audit',
];

const PAGINE_SOCIO = [
	'/member-portal', '/member-portal/corsi', '/member-portal/allenamento',
	'/member-portal/documenti', '/member-portal/abbonamento',
	'/member-portal/qr', '/member-portal/anagrafica',
];

// Il riquadro dell'ErrorBoundary: se compare, la pagina è caduta.
const SCHERMATA_ROTTA = /si è bloccata|Riprova|Torna all'inizio/i;

const problemi = [];

async function apri(pagina, percorso, base) {
	const errori = [];
	const ascoltatore = (e) => errori.push(e.message);
	pagina.on('pageerror', ascoltatore);

	await pagina.goto(`${base}${percorso}`, { waitUntil: 'networkidle' });
	await pagina.waitForTimeout(1200);
	const testo = (await pagina.locator('body').innerText()).trim();

	pagina.off('pageerror', ascoltatore);

	const rotta = SCHERMATA_ROTTA.test(testo);
	const vuota = testo.length < 20;
	const ok = errori.length === 0 && !rotta && !vuota;

	if (!ok) {
		problemi.push({ percorso, errori, rotta, vuota, testo: testo.slice(0, 120) });
	}
	const motivo = errori[0] ?? (rotta ? 'ErrorBoundary' : vuota ? 'pagina vuota' : '');
	console.log(`  ${ok ? 'OK     ' : 'ROTTA  '} ${percorso}${motivo ? ` — ${motivo.slice(0, 90)}` : ''}`);
	return ok;
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
let idSocio;

try {
	const [socio] = await db
		.insert(members)
		.values({ fullName: 'Socio Giro Pagine', email: emailSocio })
		.returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Admin Giro Pagine', email: emailStaff, passwordHash, ruolo: 'admin' },
			{ nome: 'Socio Giro Pagine', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	app = buildApp({ logger: false });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	const BASE = `http://127.0.0.1:${PORTA}`;

	browser = await chromium.launch();

	console.log('\nGESTIONALE');
	const ctxStaff = await browser.newContext();
	const pagStaff = await ctxStaff.newPage();
	await entra(pagStaff, BASE, '/', emailStaff);
	for (const percorso of PAGINE_STAFF) await apri(pagStaff, percorso, BASE);

	console.log('\nPORTALE SOCI');
	const ctxSocio = await browser.newContext();
	const pagSocio = await ctxSocio.newPage();
	await entra(pagSocio, BASE, '/member-portal', emailSocio);
	for (const percorso of PAGINE_SOCIO) await apri(pagSocio, percorso, BASE);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await pool.end();
}

const totale = PAGINE_STAFF.length + PAGINE_SOCIO.length;
console.log(`\n${totale - problemi.length}/${totale} pagine si aprono senza errori`);
if (problemi.length) {
	console.log('\nDettaglio:');
	for (const p of problemi) {
		console.log(`\n  ${p.percorso}`);
		for (const e of p.errori) console.log(`    errore: ${e}`);
		if (p.rotta) console.log('    la pagina è caduta nell\'ErrorBoundary');
		if (p.vuota) console.log(`    pagina vuota — testo: ${JSON.stringify(p.testo)}`);
	}
}
process.exit(problemi.length ? 1 : 0);
