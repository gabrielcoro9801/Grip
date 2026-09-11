/**
 * Le due sessioni, provate in un browser vero.
 *
 * I test in `server/test/` girano contro le rotte con `app.inject()`, e quelli in
 * `src/core/` girano in memoria: nessuno dei due può dire se l'applicazione *si apre*. Le
 * cose che si rompono nel passaggio — un token letto prima che l'archivio sia pronto, un
 * provider montato nel ramo sbagliato — si vedono solo qui.
 *
 * Serve soprattutto per una cosa che prima era impossibile e ora deve funzionare: tenere
 * aperti il gestionale e il portale **nello stesso browser**.
 *
 * Come si usa:
 *   1. npm run build          (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:browser
 *
 * Richiede un PostgreSQL raggiungibile, come i test: si crea due account e li cancella.
 * Il browser lo installa `npx playwright install chromium`, una volta sola.
 */
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts } from '../src/db/schema/index.js';

const PASSWORD = 'verifica-sessioni-1234';
const PORTA = 4599;
const suffisso = Date.now();
const emailStaff = `verifica.staff.${suffisso}@test.local`;
const emailSocio = `verifica.socio.${suffisso}@test.local`;

// Quello che si vede quando si è dentro, da una parte e dall'altra.
const DENTRO_GESTIONALE = /Dashboard|Soci|Allenamento/i;
const DENTRO_PORTALE = /Abbonamento|QR accesso|Corsi/i;
const SCHERMATA_ACCESSO = /Accedi|Password/i;

const esiti = [];
function controlla(nome, condizione, dettaglio = '') {
	const ok = Boolean(condizione);
	esiti.push({ nome, ok });
	const breve = dettaglio.slice(0, 60).replace(/\s+/g, ' ');
	console.log(`  ${ok ? 'OK     ' : 'FALLITO'} ${nome}${breve ? ` — ${breve}` : ''}`);
}

async function entra(pagina, email) {
	await pagina.locator('input[type=email]').first().fill(email);
	await pagina.locator('input[type=password]').first().fill(PASSWORD);
	await pagina.locator('button[type=submit]').first().click();
	await pagina.waitForTimeout(2500);
	return pagina.locator('body').innerText();
}

const chiaviDi = (pagina) =>
	pagina.evaluate(() => ({
		staff: localStorage.getItem('grip_staff_token'),
		socio: localStorage.getItem('grip_member_token'),
		vecchia: localStorage.getItem('grip_auth_token'),
	}));

let app;
let browser;
const idAccount = [];
let idSocio;

try {
	const [socio] = await db
		.insert(members)
		.values({ fullName: 'Socio Verifica', email: emailSocio })
		.returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Admin Verifica', email: emailStaff, passwordHash, ruolo: 'admin' },
			{ nome: 'Socio Verifica', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	app = buildApp({ logger: false });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	const BASE = `http://127.0.0.1:${PORTA}`;

	browser = await chromium.launch();
	const contesto = await browser.newContext();
	const errori = [];

	const pagStaff = await contesto.newPage();
	pagStaff.on('pageerror', (e) => errori.push(`gestionale: ${e.message}`));
	await pagStaff.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	const testoStaff = await entra(pagStaff, emailStaff);
	controlla('lo staff entra nel gestionale', DENTRO_GESTIONALE.test(testoStaff), testoStaff);

	// Stesso browser, stesso contesto: è qui che prima uno dei due cadeva.
	const pagSocio = await contesto.newPage();
	pagSocio.on('pageerror', (e) => errori.push(`portale: ${e.message}`));
	await pagSocio.goto(`${BASE}/member-portal`, { waitUntil: 'networkidle' });
	const testoSocio = await entra(pagSocio, emailSocio);
	controlla('il socio entra nel portale', DENTRO_PORTALE.test(testoSocio), testoSocio);

	const chiavi = await chiaviDi(pagSocio);
	controlla('le due sessioni hanno chiavi distinte', chiavi.staff && chiavi.socio && chiavi.staff !== chiavi.socio);
	controlla('la chiave unica di prima non viene ricreata', chiavi.vecchia === null);

	await pagStaff.reload({ waitUntil: 'networkidle' });
	await pagStaff.waitForTimeout(2000);
	const staffDopo = await pagStaff.locator('body').innerText();
	controlla(
		"il gestionale resta connesso dopo l'accesso del socio",
		DENTRO_GESTIONALE.test(staffDopo) && !SCHERMATA_ACCESSO.test(staffDopo.slice(0, 200)),
		staffDopo
	);

	await pagSocio.reload({ waitUntil: 'networkidle' });
	await pagSocio.waitForTimeout(2000);
	controlla(
		'il portale resta connesso dopo un ricaricamento',
		DENTRO_PORTALE.test(await pagSocio.locator('body').innerText())
	);

	// La migrazione: gira una volta sola sul browser di ognuno, e non si può rifare.
	const pagMigra = await (await browser.newContext()).newPage();
	await pagMigra.goto(`${BASE}/member-portal`, { waitUntil: 'domcontentloaded' });
	await pagMigra.evaluate((t) => localStorage.setItem('grip_auth_token', t), chiavi.socio);
	await pagMigra.reload({ waitUntil: 'networkidle' });
	await pagMigra.waitForTimeout(2500);
	const testoMigrato = await pagMigra.locator('body').innerText();
	const chiaviMigrate = await chiaviDi(pagMigra);
	controlla('chi era connesso con la chiave vecchia resta dentro', DENTRO_PORTALE.test(testoMigrato), testoMigrato);
	controlla('la chiave vecchia sparisce', chiaviMigrate.vecchia === null);
	controlla('il token finisce nella chiave del socio', chiaviMigrate.socio === chiavi.socio);

	// Il controllo del ruolo al ripristino: senza, al socio si apriva il gestionale vuoto.
	const pagIntrusa = await (await browser.newContext()).newPage();
	await pagIntrusa.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
	await pagIntrusa.evaluate((t) => localStorage.setItem('grip_staff_token', t), chiavi.socio);
	await pagIntrusa.reload({ waitUntil: 'networkidle' });
	await pagIntrusa.waitForTimeout(2500);
	const testoIntrusa = await pagIntrusa.locator('body').innerText();
	controlla('un token di socio non apre il gestionale', SCHERMATA_ACCESSO.test(testoIntrusa), testoIntrusa);
	controlla('e viene buttato via, non lasciato lì', (await pagIntrusa.evaluate(() => localStorage.getItem('grip_staff_token'))) === null);

	controlla('nessun errore JavaScript in pagina', errori.length === 0, errori.slice(0, 2).join(' | '));
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli superati`);
process.exit(falliti ? 1 : 0);
