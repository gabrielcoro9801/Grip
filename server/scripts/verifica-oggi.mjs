/**
 * Il giro del CRM, provato in un browser vero: Oggi, l'ingresso, il diario, la dashboard e Ctrl+K.
 *
 * Un socio con l'abbonamento che scade fra tre giorni deve comparire in Oggi e quando entra (la
 * registrazione dell'ingresso); il "proposto il rinnovo" segnato lì finisce nel diario e lo toglie
 * da Oggi; la dashboard
 * conta gli stessi rinnovi del motore; Ctrl+K lo trova da un numero scritto in un altro formato.
 *
 * Come si usa:
 *   1. npx vite build        (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:oggi
 *
 * Richiede un PostgreSQL raggiungibile, come i test: crea i suoi dati e li cancella alla fine.
 * Usa Edge (`channel: 'msedge'`) se c'è, altrimenti il Chromium di Playwright.
 */
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, persone, staffAccounts, subscriptions, ingressi } from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'verifica-oggi-1234';
const PORTA = 4598;
const BASE = `http://127.0.0.1:${PORTA}`;
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const cifre = String(t).slice(-7);
const NOME = `Mario Scadenza${lettere.slice(-4)}`;
const oggi = oggiIso();

const esiti = [];
function controlla(nome, condizione, dettaglio = '') {
	esiti.push({ nome, ok: Boolean(condizione) });
	console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${dettaglio ? ` — ${String(dettaglio).slice(0, 90).replace(/\s+/g, ' ')}` : ''}`);
}

let app;
let browser;
const id = {};
try {
	const [socio] = await db.insert(members).values({
		nome: 'Mario', cognome: `Scadenza${lettere.slice(-4)}`, codiceSocio: `VO${lettere}`, phone: `+39340${cifre}`, email: `mario.${t}@test.local`,
	}).returning();
	id.socio = socio.id;
	id.persona = socio.personaId;
	await db.insert(subscriptions).values({ memberId: socio.id, planName: 'Mensile', startDate: spostaGiorni(oggi, -27), endDate: spostaGiorni(oggi, 3) });
	// Viene spesso: l'unico segnale è la scadenza.
	await db.insert(ingressi).values([2, 4, 6].map((g) => ({
		memberId: socio.id, entratoAlle: new Date(`${spostaGiorni(oggi, -g)}T08:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Verifica',
	})));
	const [staff] = await db.insert(staffAccounts).values({
		nome: 'Reception Verifica', email: `oggi.${t}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception',
	}).returning();
	id.staff = staff.id;

	app = buildApp({ logger: false, publicBaseUrl: BASE });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());

	// Al telefono: lo staff chiama dal cellulare.
	const contesto = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const pagina = await contesto.newPage();
	const errori = [];
	pagina.on('pageerror', (e) => errori.push(e.message));
	await pagina.goto(`${BASE}/oggi`, { waitUntil: 'networkidle' });
	await pagina.locator('input[type=email]').fill(staff.email);
	await pagina.locator('input[type=password]').fill(PASSWORD);
	await pagina.locator('button[type=submit]').click();
	await pagina.getByRole('heading', { name: 'Oggi' }).waitFor();

	const riga = pagina.locator('li', { hasText: NOME });
	await riga.waitFor();
	controlla('Oggi: il socio a −3 giorni c\'è, con il perché', /scade tra 3 giorni/.test(await riga.innerText()), await riga.innerText());
	controlla('Oggi: Chiama e WhatsApp a portata di pollice', await riga.locator(`a[href="tel:+39340${cifre}"]`).count() === 1
		&& await riga.locator('a[href^="https://wa.me/39340"]').count() === 1);
	const larghezza = await pagina.evaluate(() => document.documentElement.scrollWidth);
	controlla('Oggi: niente scorrimento orizzontale a 390 px', larghezza <= 390, `${larghezza}px`);
	await pagina.screenshot({ path: path.join(os.tmpdir(), 'verifica-oggi-telefono.png'), fullPage: true });

	// L'ingresso registrato dallo staff, da desktop: è lì che si propone il rinnovo.
	await pagina.setViewportSize({ width: 1280, height: 900 });

	// L'elenco dei soci, filtrato dal server e con il filtro nell'indirizzo.
	await pagina.goto(`${BASE}/crm?fase=in_scadenza`, { waitUntil: 'networkidle' });
	const nellElenco = pagina.locator('tr', { hasText: NOME });
	await nellElenco.waitFor();
	controlla('Elenco soci: filtrato per fase dall\'indirizzo, con le colonne nuove', /In scadenza/.test(await nellElenco.innerText()), await nellElenco.innerText());
	await pagina.screenshot({ path: path.join(os.tmpdir(), 'verifica-oggi-elenco.png') });

	await pagina.goto(`${BASE}/crm/ingressi`, { waitUntil: 'networkidle' });
	await pagina.getByRole('button', { name: 'Registra ingresso' }).click();
	await pagina.getByLabel('Cerca socio').fill(NOME);
	await pagina.locator('ul li button', { hasText: NOME }).first().click();
	const proposta = pagina.getByText('Scade tra 3 giorni: proponi il rinnovo');
	await proposta.waitFor();
	controlla('Ingresso: "scade tra 3 giorni: proponi il rinnovo" accanto al semaforo', await proposta.isVisible());
	await pagina.getByRole('button', { name: 'Proposto il rinnovo' }).click();
	await pagina.getByText('Nel diario').waitFor();
	await pagina.screenshot({ path: path.join(os.tmpdir(), 'verifica-oggi-bancone.png') });
	controlla('Ingresso: un tocco lo segna nel diario', true);

	await pagina.goto(`${BASE}/oggi`, { waitUntil: 'networkidle' });
	await pagina.getByRole('heading', { name: 'Oggi' }).waitFor();
	await pagina.waitForTimeout(500);
	controlla('Oggi: dopo la proposta il segnale si nasconde', await pagina.locator('li', { hasText: NOME }).count() === 0);

	await pagina.goto(`${BASE}/crm/soci/${id.socio}`, { waitUntil: 'networkidle' });
	const diario = pagina.getByText('Di persona: proposto il rinnovo');
	await diario.waitFor();
	controlla('Scheda: il diario ha "Di persona: proposto il rinnovo"', await diario.isVisible());
	controlla('Scheda: il segnale c\'è ancora, con il giorno in cui torna', await pagina.getByText(/già seguito, torna il/).first().isVisible());
	await pagina.screenshot({ path: path.join(os.tmpdir(), 'verifica-oggi-scheda.png'), fullPage: true });

	// La dashboard conta come il motore.
	await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await pagina.getByText(NOME).first().waitFor();
	const conti = await pagina.evaluate(async () => {
		const h = { authorization: `Bearer ${localStorage.getItem('grip_staff_token')}` };
		const dash = await (await fetch('/api/dashboard', { headers: h })).json();
		const motore = await (await fetch('/api/segnali?tipo=soci', { headers: h })).json();
		return { rinnovi: dash.rinnovi.length, motore: (motore.conteggi.fasi.in_scadenza ?? 0) + (motore.conteggi.fasi.scaduto_recuperabile ?? 0) };
	});
	controlla('Dashboard: gli stessi rinnovi del motore', conti.rinnovi === conti.motore, JSON.stringify(conti));

	// Ctrl+K, con il numero scritto come lo detta il socio.
	await pagina.keyboard.press('Control+k');
	await pagina.getByRole('combobox', { name: 'Cerca una persona' }).fill(`0039 340 ${cifre.slice(0, 3)} ${cifre.slice(3)}`);
	await pagina.getByRole('option', { name: new RegExp(NOME) }).waitFor();
	await pagina.keyboard.press('Enter');
	await pagina.waitForURL(`**/crm/soci/${id.socio}`);
	controlla('Ctrl+K: trovato dal telefono in un altro formato, e aperta la scheda', pagina.url().endsWith(`/crm/soci/${id.socio}`));

	controlla('Nessun errore JavaScript nelle pagine', errori.length === 0, errori.join(' | '));
} catch (errore) {
	controlla('Il giro arriva in fondo', false, errore.message);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (id.socio) {
		await db.delete(ingressi).where(eq(ingressi.memberId, id.socio));
		await db.delete(subscriptions).where(eq(subscriptions.memberId, id.socio));
		await db.delete(members).where(eq(members.id, id.socio));
		await db.delete(persone).where(inArray(persone.id, [id.persona]));
	}
	if (id.staff) await db.delete(staffAccounts).where(eq(staffAccounts.id, id.staff));
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli superati.`);
process.exit(falliti ? 1 : 0);
