/**
 * Da fare, gli stati, l'elenco dei soci, i consensi: provati in un browser vero, con le schermate
 * nella cartella temporanea.
 *
 * - Da fare per linee: ogni linea la sua azione, il box "Fatto" che toglie solo la sua riga.
 * - /oggi porta a /da-fare; la dashboard ha le tessere delle linee.
 * - La scheda socio: lo stato in testa, niente blocco "Da seguire", i consensi in sola lettura.
 * - Impostazioni di Da fare: un segnale si spegne, e sparisce.
 * - Elenco soci: le colonne nuove, "Contatta" da tabella e tile (senza aprire la scheda).
 * - Il portale: la domanda sui consensi al primo accesso; togliere un consenso, con "Annulla".
 *
 * Come si usa:
 *   1. npx vite build        (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:da-fare
 *
 * Richiede un PostgreSQL raggiungibile, come i test: crea i suoi dati, rimette le impostazioni
 * com'erano e cancella tutto alla fine.
 */
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, attivita, consensi, organizations, memberDocuments, ingressi, auditLogs,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'verifica-da-fare-1234';
const PORTA = 4610;
const BASE = `http://127.0.0.1:${PORTA}`;
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
const fra = (n) => spostaGiorni(oggiIso(), n);
const schermata = (nome) => path.join(os.tmpdir(), `verifica-da-fare-${nome}.png`);

const esiti = [];
function controlla(nome, condizione, dettaglio = '') {
	esiti.push({ nome, ok: Boolean(condizione) });
	console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${dettaglio ? ` — ${String(dettaglio).slice(0, 110).replace(/\s+/g, ' ')}` : ''}`);
}

let app;
let browser;
const id = { soci: [], persone: [], account: [] };
const [palestra] = await db.select().from(organizations).limit(1);
const impostazioniPrima = palestra.impostazioni ?? {};
try {
	// --- I dati --------------------------------------------------------------------------
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const persone = [
		// Scade fra 3 giorni: Rinnovi.
		{ nome: 'Marco', cognome: `Rinnovi${lettere}`, fine: fra(3), ingresso: 2 },
		// Certificato scaduto: Documenti.
		{ nome: 'Sara', cognome: `Documenti${lettere}`, fine: fra(200), ingresso: 2, certificato: fra(-5) },
		// Non entra da 20 giorni: Chi non viene, e stato "In calo".
		{ nome: 'Luca', cognome: `Assente${lettere}`, fine: fra(200), ingresso: 20 },
		// Per il portale: tutto in regola, mai scelto i consensi.
		{ nome: 'Elena', cognome: `Portale${lettere}`, fine: fra(200), ingresso: 1 },
	];
	const soci = await db.insert(members).values(persone.map((p, i) => ({
		nome: p.nome, cognome: p.cognome, codiceSocio: `VD${i}${lettere}`, email: `${p.nome.toLowerCase()}.${t}@test.local`,
		phone: `+3934700000${i}${String(t).slice(-1)}`, dateOfBirth: '1990-05-20',
	}))).returning();
	soci.forEach((s) => { id.soci.push(s.id); id.persone.push(s.personaId); });
	await db.insert(subscriptions).values(soci.map((s, i) => ({ memberId: s.id, planName: 'Annuale', startDate: '2025-01-01', endDate: persone[i].fine })));
	await db.insert(memberDocuments).values(soci.flatMap((s, i) => [
		{ memberId: s.id, documentType: 'certificato_medico', expiryDate: persone[i].certificato ?? fra(300), fileName: 'certificato.pdf' },
		{ memberId: s.id, documentType: 'documento_identita', expiryDate: fra(3000), fileName: 'ci.pdf' },
	]));
	await db.insert(ingressi).values(soci.flatMap((s, i) => [persone[i].ingresso, persone[i].ingresso + 3, persone[i].ingresso + 7].map((g) => ({
		memberId: s.id, entratoAlle: new Date(`${fra(-g)}T08:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Verifica',
	}))));
	const [marco, sara, luca, elena] = soci;
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Anna Admin', email: `vd.admin.${t}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Rocco Reception', email: `vd.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Elena Portale', email: `vd.elena.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: elena.id },
	]).returning();
	id.account = account.map((a) => a.id);
	const [admin, reception, socioPortale] = account;

	app = buildApp({ logger: false, publicBaseUrl: BASE });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
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
	const riga = (p, nome) => p.locator('li').filter({ has: p.getByRole('link', { name: new RegExp(nome) }) });

	// --- 1. Da fare per linee ----------------------------------------------------------------
	console.log('\nDA FARE');
	const pg = await nuovaPagina();
	await entra(pg, '/oggi', reception.email);
	await pg.getByRole('heading', { name: 'Da fare', exact: true }).waitFor();
	controlla('/oggi porta a /da-fare', pg.url().includes('/da-fare'), pg.url());
	controlla('Il menu dice "Da fare"', await pg.getByRole('link', { name: 'Da fare' }).first().isVisible());
	await pg.getByRole('tab').first().waitFor();
	const linee = await pg.getByRole('tab').allInnerTexts();
	controlla('Le linee ci sono tutte', ['Rinnovi', 'Chi non viene', 'Nuovi soci', 'Documenti', 'Compleanni', 'Contatti'].every((l) => linee.some((x) => x.startsWith(l))), JSON.stringify(linee));

	await pg.getByRole('tab', { name: /^Rinnovi/ }).click();
	await riga(pg, `Marco Rinnovi${lettere}`).waitFor();
	controlla('Rinnovi: Marco, con "scade tra 3 giorni"', (await riga(pg, `Marco Rinnovi${lettere}`).innerText()).includes('scade tra 3 giorni'));
	controlla('Rinnovi: c\'è "Rinnova"', await riga(pg, `Marco Rinnovi${lettere}`).getByRole('link', { name: 'Rinnova' }).isVisible());
	controlla('Sara non è fra i rinnovi', await riga(pg, `Sara Documenti${lettere}`).count() === 0);
	await pg.screenshot({ path: schermata('1-rinnovi'), fullPage: true });

	await pg.getByRole('tab', { name: /^Documenti/ }).click();
	const rigaSara = riga(pg, `Sara Documenti${lettere}`);
	await rigaSara.waitFor();
	controlla('Documenti: Sara, certificato scaduto', /certificato medico scaduto il/.test(await rigaSara.innerText()));
	controlla('Documenti: c\'è "Carica"', await rigaSara.getByRole('link', { name: 'Carica' }).isVisible());

	await pg.getByRole('tab', { name: /^Chi non viene/ }).click();
	const rigaLuca = riga(pg, `Luca Assente${lettere}`);
	await rigaLuca.waitFor();
	controlla('Chi non viene: Luca, stato "In calo"', /In calo/.test(await rigaLuca.innerText()), await rigaLuca.innerText());
	const box = rigaLuca.getByRole('group', { name: /Fatto/ });
	controlla('Il box "Fatto" ha i quattro modi', (await box.getByRole('button').allInnerTexts()).join(',') === 'Di persona,Chiamato,Messaggio,Email');
	await pg.screenshot({ path: schermata('2-chi-non-viene'), fullPage: true });
	await box.getByRole('button', { name: 'Chiamato' }).click();
	await rigaLuca.waitFor({ state: 'detached' });
	controlla('Fatto: Luca esce dalla linea', true);
	const [fatto] = await db.select().from(attivita).where(eq(attivita.personaId, luca.personaId));
	controlla('Nel diario: "fatto" per "assente", al telefono', fatto?.esito === 'fatto' && fatto.canale === 'telefono' && fatto.riferimento?.segnali?.includes('assente'), JSON.stringify(fatto?.riferimento));

	// --- 2. La scheda socio --------------------------------------------------------------------
	console.log('\nSCHEDA');
	await pg.goto(`${BASE}/crm/soci/${luca.id}`, { waitUntil: 'networkidle' });
	await pg.getByRole('heading', { name: `Luca Assente${lettere}` }).waitFor();
	controlla('In testa lo stato: In calo', await pg.getByText('In calo', { exact: true }).first().isVisible());
	controlla('Niente blocco "Da seguire"', await pg.getByText('Da seguire', { exact: true }).count() === 0);
	controlla('Niente "Registra contatto" né "Rimanda"', await pg.getByRole('button', { name: /Registra contatto|Rimanda/ }).count() === 0);
	controlla('Il diario racconta il Fatto', await pg.getByText(/Fatto: chiamato · Non viene da un po'/).isVisible());
	const consensiCard = pg.locator('div').filter({ has: pg.getByText('Comunicazioni promozionali', { exact: true }) }).last();
	controlla('Consensi in sola lettura: niente caselle', await consensiCard.getByRole('checkbox').count() === 0);
	await pg.getByRole('button', { name: 'Registra consenso firmato' }).click();
	controlla('Senza modulo caricato, il consenso non si registra', await pg.getByText(/Prima carica il modulo firmato/).isVisible());
	controlla('…e "Registra" resta spento', await pg.getByRole('button', { name: 'Registra', exact: true }).isDisabled());
	await pg.screenshot({ path: schermata('3-scheda'), fullPage: true });
	await pg.keyboard.press('Escape');

	await pg.goto(`${BASE}/crm/soci/${sara.id}?azione=documenti`, { waitUntil: 'networkidle' });
	controlla('"Carica" porta ai documenti, e l\'indirizzo si pulisce', !pg.url().includes('azione='), pg.url());
	await pg.goto(`${BASE}/crm/soci/${marco.id}?azione=rinnova`, { waitUntil: 'networkidle' });
	controlla('"Rinnova" apre il nuovo abbonamento', await pg.getByRole('heading', { name: 'Nuovo abbonamento' }).isVisible());
	await pg.keyboard.press('Escape');

	// --- 3. L'elenco dei soci --------------------------------------------------------------------
	console.log('\nELENCO SOCI');
	await pg.goto(`${BASE}/crm`, { waitUntil: 'networkidle' });
	await pg.getByRole('button', { name: /Tabella/ }).click();
	const intestazioni = (await pg.locator('thead th').allInnerTexts()).map((x) => x.trim());
	controlla('Colonne: Socio, Stato, Stato abbonamento, Scadenza, Ingressi, Contatta', intestazioni.slice(0, 5).join('|') === 'Socio|Stato|Stato abbonamento|Scadenza|Ingressi in 4 settimane', intestazioni.join('|'));
	await pg.getByRole('button', { name: 'Che cosa vogliono dire gli stati' }).click();
	controlla('La legenda degli stati', await pg.getByRole('heading', { name: 'Gli stati dei soci' }).isVisible());
	await pg.keyboard.press('Escape');
	await pg.getByRole('button', { name: `Contatta Marco Rinnovi${lettere}` }).click();
	const dialogo = pg.getByRole('dialog');
	controlla('Contatta: chiama, WhatsApp, SMS, email', (await dialogo.getByRole('link').allInnerTexts()).join(',').replace(/\s/g, '') === 'Chiama,WhatsApp,SMS,Email', await dialogo.innerText());
	await pg.screenshot({ path: schermata('4-contatta'), fullPage: true });
	await pg.keyboard.press('Escape');
	await pg.getByRole('button', { name: /Tile/ }).click();
	await pg.getByRole('button', { name: `Contatta Sara Documenti${lettere}` }).click();
	controlla('Contatta dalla tile non apre la scheda', pg.url().endsWith('/crm') && await pg.getByRole('dialog').isVisible(), pg.url());
	await pg.keyboard.press('Escape');

	// --- 4. La dashboard ---------------------------------------------------------------------------
	console.log('\nDASHBOARD');
	await pg.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	const tessera = pg.getByRole('link', { name: /^Rinnovi/ });
	controlla('La tessera dei Rinnovi', await tessera.isVisible());
	controlla('Niente più liste doppie', await pg.getByText('Avvisi certificati').count() === 0 && await pg.getByText('Rinnovi abbonamenti').count() === 0);
	await pg.screenshot({ path: schermata('5-dashboard'), fullPage: true });
	await tessera.click();
	await pg.waitForURL(/\/da-fare\?linea=rinnovi/);
	controlla('Un clic porta alla linea', true);

	// --- 5. Le impostazioni ------------------------------------------------------------------------
	console.log('\nIMPOSTAZIONI');
	const am = await nuovaPagina();
	await entra(am, '/admin/da-fare', admin.email);
	await am.getByRole('heading', { name: 'Impostazioni di Da fare' }).waitFor();
	controlla('Ogni segnale con la sua regola', await am.getByText(/Scatta quando nessun ingresso da 14 giorni/).isVisible());
	await am.getByRole('checkbox', { name: 'Segui «Documento scaduto»' }).click();
	await am.getByRole('button', { name: 'Salva' }).first().click();
	await am.getByText('Impostazioni salvate').first().waitFor();
	controlla('Spento e salvato', true);
	await am.screenshot({ path: schermata('6-impostazioni'), fullPage: true });
	await pg.goto(`${BASE}/da-fare?linea=documenti`, { waitUntil: 'networkidle' });
	controlla('Il segnale spento sparisce da Da fare', await riga(pg, `Sara Documenti${lettere}`).count() === 0);
	controlla('Comunicazioni non ha più la scheda Soglie', await (async () => {
		await am.goto(`${BASE}/admin/comunicazioni`, { waitUntil: 'networkidle' });
		return await am.getByRole('tab', { name: 'Soglie' }).count() === 0;
	})());

	// --- 6. Da telefono ------------------------------------------------------------------------------
	const tel = await nuovaPagina({ width: 390, height: 844 });
	await entra(tel, '/da-fare?linea=rinnovi', reception.email);
	await riga(tel, `Marco Rinnovi${lettere}`).waitFor();
	const larghezza = await tel.evaluate(() => document.documentElement.scrollWidth);
	controlla('Da telefono non scorre di lato', larghezza <= 390, `${larghezza}px`);
	await tel.screenshot({ path: schermata('7-telefono'), fullPage: true });

	// --- 7. Il portale -----------------------------------------------------------------------------
	console.log('\nPORTALE');
	const portale = await nuovaPagina({ width: 390, height: 844 });
	await entra(portale, '/member-portal', socioPortale.email);
	// Al primo accesso il portale chiede di cambiare password.
	if (await portale.getByText(/nuova password/i).count()) {
		const campi = portale.locator('input[type=password]');
		const nuova = `${PASSWORD}-nuova`;
		for (let i = 0; i < await campi.count(); i += 1) await campi.nth(i).fill(i === 0 && await campi.count() === 3 ? PASSWORD : nuova);
		await portale.locator('button[type=submit]').click();
		await portale.waitForLoadState('networkidle');
	}
	await portale.getByText('Vuoi ricevere anche promozioni e novità?').waitFor();
	controlla('La domanda al primo accesso', true);
	await portale.getByRole('button', { name: 'Salva le mie scelte' }).click();
	await portale.getByText('Vuoi ricevere anche promozioni e novità?').waitFor({ state: 'detached' });
	controlla('Scelto anche il "no": la domanda non torna', (await db.select().from(consensi).where(eq(consensi.personaId, elena.personaId))).length === 3);
	await portale.goto(`${BASE}/member-portal/anagrafica`, { waitUntil: 'networkidle' });
	const email = portale.getByRole('checkbox').first();
	await email.click();
	await portale.waitForLoadState('networkidle');
	await email.click();
	await portale.getByText(/^Tolto:/).waitFor();
	controlla('Togliere è un tocco, con "Annulla"', await portale.getByRole('button', { name: 'Annulla' }).isVisible());
	await portale.screenshot({ path: schermata('8-portale'), fullPage: true });
	await portale.getByRole('button', { name: 'Annulla' }).click();
	await portale.getByText(/^Tolto:/).waitFor({ state: 'detached' });
	const ridato = await portale.waitForFunction(() => document.querySelector('[role=checkbox]')?.getAttribute('data-state') === 'checked', null, { timeout: 5000 }).then(() => true, () => false);
	controlla('"Annulla" lo ridà', ridato);

	controlla('Nessun errore JavaScript', errori.length === 0, errori.join(' | '));
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (id.persone.length) {
		await db.delete(consensi).where(inArray(consensi.personaId, id.persone));
		await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
	}
	if (id.account.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	if (id.soci.length) {
		await db.delete(ingressi).where(inArray(ingressi.memberId, id.soci));
		await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, id.soci));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
		await db.delete(members).where(inArray(members.id, id.soci));
	}
	await db.delete(auditLogs).where(eq(auditLogs.entitaTipo, 'impostazioni'));
	await db.update(organizations).set({ impostazioni: impostazioniPrima }).where(eq(organizations.id, palestra.id));
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli passati. Schermate: ${path.join(os.tmpdir(), 'verifica-da-fare-*.png')}`);
process.exit(falliti ? 1 : 0);
