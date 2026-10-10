/**
 * La fase 4 del CRM, provata in un browser vero, con le schermate nella cartella temporanea.
 *
 * - Configurare l'email (fornitore simulato: nessun invio vero) e verificarla con l'invio di prova.
 * - Mettere il rinnovo in anteprima e leggere "domani sarebbero partiti N messaggi", con il testo
 *   su una persona vera; il giro scrive solo messaggi simulati, che compaiono nel registro.
 * - L'interruttore generale resta chiuso finché la lista di controllo non è completa.
 * - La reception non vede la sezione; la pagina regge un telefono.
 *
 * Come si usa:
 *   1. npx vite build        (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:fase4
 *
 * Richiede un PostgreSQL raggiungibile, come i test: crea i suoi dati, rimette le impostazioni
 * com'erano e cancella tutto alla fine. Non manda niente: INVII_REALI resta spento.
 */
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, attivita, consensi, organizations, messaggi, notifiche, segretiCanali, modelliMessaggio, auditLogs,
} from '../src/db/schema/index.js';
import { config } from '../src/config.js';
import { giroInvii } from '../src/lib/invii.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'verifica-fase4-1234';
const PORTA = 4600;
const BASE = `http://127.0.0.1:${PORTA}`;
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
const fra = (n) => spostaGiorni(oggiIso(), n);
const schermata = (nome) => path.join(os.tmpdir(), `verifica-fase4-${nome}.png`);

const esiti = [];
function controlla(nome, condizione, dettaglio = '') {
	esiti.push({ nome, ok: Boolean(condizione) });
	console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${dettaglio ? ` — ${String(dettaglio).slice(0, 110).replace(/\s+/g, ' ')}` : ''}`);
}

if (config.inviiReali) {
	console.error('INVII_REALI è acceso: questo script non parte, per non mandare niente a nessuno.');
	process.exit(1);
}
config.chiaveSegreti ??= 'chiave-della-verifica-fase4';
config.publicBaseUrl ??= BASE;

let app;
let browser;
const id = { soci: [], persone: [], account: [] };
const [palestra] = await db.select().from(organizations).limit(1);
const impostazioniPrima = palestra.impostazioni ?? {};
const segretiPrima = await db.select().from(segretiCanali);
const modelliPrima = await db.select().from(modelliMessaggio);
try {
	// --- I dati --------------------------------------------------------------------------
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	// Comunicazioni come al primo deploy: tutto spento.
	await db.update(organizations).set({ impostazioni: { ...impostazioniPrima, comunicazioni: {} } }).where(eq(organizations.id, palestra.id));
	await db.delete(segretiCanali);
	await db.delete(modelliMessaggio);
	const [giulia] = await db.insert(members).values({
		nome: 'Giulia', cognome: `Scadenza${lettere}`, codiceSocio: `V4G${lettere}`, email: `giulia.${t}@test.local`, phone: '+393471234567', dateOfBirth: '1991-04-04',
	}).returning();
	id.soci.push(giulia.id); id.persone.push(giulia.personaId);
	// Scade tra due giorni: domani è "scade tra 1 giorno", nella finestra dei 3.
	await db.insert(subscriptions).values({ memberId: giulia.id, planName: 'Trimestrale', startDate: fra(-88), endDate: fra(2) });
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Anna Admin', email: `v4.admin.${t}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Rocco Reception', email: `v4.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Giulia Scadenza', email: `v4.giulia.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: giulia.id },
	]).returning();
	id.account = account.map((a) => a.id);
	const [admin, reception] = account;

	app = buildApp({ logger: false, publicBaseUrl: BASE });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch())
		.catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
	const errori = [];
	const nuovaPagina = async (viewport = { width: 1280, height: 900 }) => {
		const p = await (await browser.newContext({ viewport })).newPage();
		p.on('pageerror', (e) => errori.push(e.message));
		return p;
	};
	const entra = async (p, url, email) => {
		await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
		await p.locator('input[type=email]').fill(email);
		await p.locator('input[type=password]').fill(PASSWORD);
		await p.locator('button[type=submit]').click();
		await p.waitForLoadState('networkidle');
	};

	// --- 1. Spento, al primo deploy -------------------------------------------------------
	console.log('\nSPENTO');
	const pg = await nuovaPagina();
	await entra(pg, '/admin/comunicazioni', admin.email);
	await pg.getByRole('heading', { name: 'Comunicazioni', exact: true }).waitFor();
	controlla('Il menu porta a Comunicazioni', await pg.getByRole('link', { name: 'Comunicazioni' }).isVisible());
	controlla('Le comunicazioni sono spente', await pg.getByText('Comunicazioni spente').isVisible());
	controlla('Avvisa che il server è in simulazione', await pg.getByText('Modalità simulazione.').isVisible());
	controlla('L\'interruttore è chiuso', await pg.getByRole('button', { name: 'Accendi le comunicazioni' }).isDisabled());
	await pg.screenshot({ path: schermata('1-stato'), fullPage: true });

	// --- 2. I canali ----------------------------------------------------------------------
	console.log('\nCANALI');
	await pg.getByRole('tab', { name: 'Canali' }).click();
	await pg.getByRole('button', { name: 'Attiva le notifiche nel portale' }).click();
	await pg.getByRole('button', { name: 'Disattiva' }).waitFor();
	controlla('Notifiche nel portale attive', true);
	await pg.locator('#email-fornitore').click();
	await pg.getByRole('option', { name: 'Brevo (servizio di invio)' }).click();
	await pg.locator('#email-mittente').fill('info@palestra-verifica.test');
	await pg.locator('#email-nome_mittente').fill('Palestra Verifica');
	await pg.locator('#email-segreto').fill('chiave-brevo-finta');
	await pg.getByRole('button', { name: 'Salva la configurazione' }).first().click();
	await pg.getByText('Da verificare').first().waitFor();
	controlla('Email configurata: da verificare', true);
	controlla('La chiave non torna indietro', !(await pg.content()).includes('chiave-brevo-finta') || await pg.locator('#email-segreto').inputValue() === '');
	await pg.getByRole('button', { name: 'Invia la prova' }).first().click();
	const simulato = pg.getByLabel('Messaggio simulato');
	await simulato.waitFor();
	const codice = (await simulato.innerText()).match(/\d{6}/)?.[0];
	controlla('La prova è simulata e mostra il codice', Boolean(codice));
	await pg.locator('#email-codice').fill(codice ?? '');
	await pg.getByRole('button', { name: 'Verifica' }).click();
	await pg.getByText('(in simulazione)').waitFor();
	const statoEmail = await pg.locator('h3, [class*=CardTitle]').filter({ hasText: 'Email' }).first().innerText().catch(() => '');
	controlla('Email pronta dopo la verifica', /Pronto/.test(statoEmail) || await pg.getByText('Pronto').count() >= 2, statoEmail);
	await pg.screenshot({ path: schermata('2-canali'), fullPage: true });

	// --- 3. Il playbook in anteprima ------------------------------------------------------
	console.log('\nPLAYBOOK');
	await pg.getByRole('tab', { name: 'Playbook' }).click();
	const rinnovo = pg.getByRole('group', { name: 'Stato di Rinnovo' });
	await rinnovo.getByRole('button', { name: 'Anteprima' }).click();
	await pg.waitForFunction(() => document.querySelector('[aria-label="Stato di Rinnovo"] [aria-pressed="true"]')?.textContent === 'Anteprima');
	controlla('Rinnovo in anteprima', true);
	await pg.getByRole('button', { name: 'Anteprima di domani' }).first().click();
	const finestra = pg.getByRole('dialog');
	const totale = finestra.getByTestId('totale-anteprima');
	await totale.waitFor();
	const frase = await totale.innerText();
	controlla('"Domani sarebbero partiti N messaggi"', /Domani sarebbero partiti [1-9]\d* messagg/.test(frase), frase);
	controlla('Con il testo per Giulia', await finestra.getByText(/Ciao Giulia, il tuo abbonamento Trimestrale scade domani/).isVisible());
	await pg.screenshot({ path: schermata('3-anteprima'), fullPage: false });
	await pg.keyboard.press('Escape');

	await pg.getByRole('button', { name: 'Testi' }).first().click();
	const testi = pg.getByRole('dialog');
	await testi.locator('#anteprima-persona').fill(`Scadenza${lettere}`);
	await testi.getByRole('button', { name: `Giulia Scadenza${lettere}` }).click();
	await testi.getByLabel('Anteprima del messaggio').getByText(/Ciao Giulia/).waitFor();
	controlla('Anteprima del testo su una persona vera', true);
	await pg.screenshot({ path: schermata('4-testi'), fullPage: false });
	await pg.keyboard.press('Escape');

	// --- 4. Il giro scrive solo "simulato"; il registro lo mostra -------------------------
	console.log('\nGIRO');
	const mattina = new Date(`${oggiIso()}T09:00:00Z`);
	const esito = await giroInvii(db, { adesso: mattina });
	const scritti = await db.select().from(messaggi).where(eq(messaggi.personaId, giulia.personaId));
	controlla('Il giro scrive un messaggio simulato, e nient\'altro', scritti.length === 1 && scritti[0].stato === 'simulato' && esito.accodati === 0, JSON.stringify(esito));
	controlla('Nessuna notifica vera a Giulia', (await db.select().from(notifiche).where(eq(notifiche.memberId, giulia.id))).length === 0);
	await pg.getByRole('tab', { name: 'Registro' }).click();
	await pg.getByText(`Giulia Scadenza${lettere}`).waitFor();
	controlla('Il registro mostra il messaggio simulato', await pg.getByText('Simulato', { exact: true }).first().isVisible());
	await pg.screenshot({ path: schermata('5-registro'), fullPage: true });

	// --- 5. L'interruttore e la lista di controllo ----------------------------------------
	console.log('\nINTERRUTTORE');
	await pg.getByRole('tab', { name: 'Stato' }).click();
	const accendi = pg.getByRole('button', { name: 'Accendi le comunicazioni' });
	await pg.getByRole('button', { name: 'Confermo' }).first().click();
	await pg.waitForTimeout(300);
	controlla('Con l\'informativa confermata, ancora chiuso', await accendi.isDisabled());
	await pg.getByRole('button', { name: 'Confermo' }).first().click();
	await pg.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => b.textContent === 'Accendi le comunicazioni')?.disabled);
	controlla('A lista completa, l\'interruttore si apre', await accendi.isEnabled());
	await pg.screenshot({ path: schermata('6-lista-completa'), fullPage: true });

	// --- 6. Telefono, reception, disiscrizione --------------------------------------------
	console.log('\nALTRO');
	const tel = await nuovaPagina({ width: 390, height: 844 });
	await entra(tel, '/admin/comunicazioni', admin.email);
	await tel.getByRole('heading', { name: 'Comunicazioni', exact: true }).waitFor();
	const larghezza = await tel.evaluate(() => document.documentElement.scrollWidth);
	controlla('Niente scorrimento orizzontale a 390 px', larghezza <= 390, `${larghezza}px`);
	await tel.getByRole('tab', { name: 'Playbook' }).click();
	await tel.screenshot({ path: schermata('7-telefono'), fullPage: true });

	const rec = await nuovaPagina();
	await entra(rec, '/admin/comunicazioni', reception.email);
	controlla('La reception non vede la voce di menu', !(await rec.getByRole('link', { name: 'Comunicazioni' }).isVisible().catch(() => false)));
	controlla('La reception non apre la sezione', !(await rec.getByText('Modalità simulazione.').isVisible().catch(() => false)));
	await rec.screenshot({ path: schermata('8-reception'), fullPage: true });

	const { linkDisiscrizione } = await import('../src/lib/urlFirmati.js');
	const dis = await nuovaPagina({ width: 390, height: 700 });
	await dis.goto(linkDisiscrizione(giulia.personaId, 'marketing_email', `${BASE}/disiscrizione`));
	controlla('La pagina di disiscrizione chiede conferma', await dis.getByRole('button', { name: 'Sì, non inviarmele più' }).isVisible());
	await dis.getByRole('button', { name: 'Sì, non inviarmele più' }).click();
	await dis.getByRole('heading', { name: 'Fatto' }).waitFor();
	const [ultimo] = await db.select().from(consensi).where(eq(consensi.personaId, giulia.personaId));
	controlla('Il consenso tolto finisce nel registro', ultimo?.fonte === 'disiscrizione' && ultimo.valore === false);
	await dis.screenshot({ path: schermata('9-disiscrizione') });

	controlla('Nessun errore JavaScript nelle pagine', errori.length === 0, errori.join(' | '));
} catch (errore) {
	controlla('Il giro arriva in fondo', false, errore.message);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (id.persone.length) {
		await db.delete(messaggi).where(inArray(messaggi.personaId, id.persone));
		await db.delete(consensi).where(inArray(consensi.personaId, id.persone));
		await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
	}
	if (id.account.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	if (id.soci.length) {
		await db.delete(notifiche).where(inArray(notifiche.memberId, id.soci));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
		await db.delete(members).where(inArray(members.id, id.soci));
	}
	await db.delete(auditLogs).where(eq(auditLogs.entitaTipo, 'comunicazioni'));
	// Le impostazioni, le credenziali e i testi tornano com'erano.
	await db.update(organizations).set({ impostazioni: impostazioniPrima }).where(eq(organizations.id, palestra.id));
	await db.delete(segretiCanali);
	if (segretiPrima.length) await db.insert(segretiCanali).values(segretiPrima);
	await db.delete(modelliMessaggio);
	if (modelliPrima.length) await db.insert(modelliMessaggio).values(modelliPrima);
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli superati. Schermate in ${os.tmpdir()}`);
process.exit(falliti ? 1 : 0);
