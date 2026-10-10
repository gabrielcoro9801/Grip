/**
 * La fase 3 del CRM, provata in un browser vero, con le schermate in %TEMP%.
 *
 * - Un contatto diventa socio con abbonamento, certificato e accesso al portale in un'unica finestra.
 * - Il socio chiede il rinnovo dal portale e in Oggi compare in cima; registrato il contatto, sparisce.
 * - Un abbonamento sospeso per 14 giorni scade 14 giorni dopo, e il socio non risulta assente.
 * - L'istruttore vede presenti e no-show della sua lezione, e non vede altri soci.
 * - Chi è entrato dal tornello dopo tanto compare in cima a Oggi con il bentornato.
 *
 * Come si usa:
 *   1. npx vite build        (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:fase3
 *
 * Richiede un PostgreSQL raggiungibile, come i test: crea i suoi dati e li cancella alla fine.
 * Usa Edge (`channel: 'msedge'`) se c'è, altrimenti il Chromium di Playwright.
 */
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, ingressi, trattative, canaliContatto, plans, memberDocuments, attivita, consensi,
	sospensioni, instructors, courses, events, sessions, rooms, bookings, auditLogs, numberingCounters,
} from '../src/db/schema/index.js';
import { enteDellaNumerazione } from '../src/lib/codiceSocio.js';
import { carattereDiControllo } from '../../shared/anagrafica.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'verifica-fase3-1234';
const PORTA = 4599;
const BASE = `http://127.0.0.1:${PORTA}`;
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);
const CF = (() => { const primi = `${lettere}90A41H501`; return primi + carattereDiControllo(primi); })();
const schermata = (nome) => path.join(os.tmpdir(), `verifica-fase3-${nome}.png`);

const esiti = [];
function controlla(nome, condizione, dettaglio = '') {
	esiti.push({ nome, ok: Boolean(condizione) });
	console.log(`  ${condizione ? 'OK     ' : 'FALLITO'} ${nome}${dettaglio ? ` — ${String(dettaglio).slice(0, 110).replace(/\s+/g, ' ')}` : ''}`);
}

let app;
let browser;
const id = { soci: [], persone: [], account: [], file: [] };
let contatore = null;
try {
	// --- I dati --------------------------------------------------------------------------
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const ente = await enteDellaNumerazione(db);
	if (ente) [contatore] = await db.select().from(numberingCounters).where(and(eq(numberingCounters.organizationId, ente), eq(numberingCounters.scope, 'codice_socio')));
	const [canale] = await db.insert(canaliContatto).values({ nome: `Verifica fase 3 ${t}` }).returning();
	id.canale = canale.id;
	const [tipo] = await db.insert(plans).values({ name: `Trimestrale ${lettere}`, price: 120, durataValore: 3, durataUnita: 'mesi' }).returning();
	id.tipo = tipo.id;
	// Il contatto che si iscrive.
	const [personaLead] = await db.insert(persone).values({ nome: 'Lucia', cognome: `Nuova${lettere}`, telefono: '+393401112233', email: `lucia.${t}@test.local` }).returning();
	id.persone.push(personaLead.id);
	await db.insert(trattative).values({ personaId: personaLead.id, dataContatto: oggi, canaleId: canale.id });

	const nuovoSocio = async (nome, cognome, extra = {}) => {
		const [s] = await db.insert(members).values({ nome, cognome: `${cognome}${lettere}`, codiceSocio: `V3${cognome.slice(0, 2).toUpperCase()}${lettere}`, ...extra }).returning();
		id.soci.push(s.id); id.persone.push(s.personaId);
		return s;
	};
	// Chi chiede il rinnovo dal portale: valido, entra spesso, niente da fare finché non chiede.
	const rinnova = await nuovoSocio('Rita', 'Rinnovo', { email: `rita.${t}@test.local` });
	await db.insert(subscriptions).values({ memberId: rinnova.id, planName: 'Mensile', startDate: '2025-01-01', endDate: fra(40) });
	await db.insert(ingressi).values([1, 3, 6].map((g) => ({ memberId: rinnova.id, entratoAlle: new Date(`${fra(-g)}T08:00:00Z`), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Verifica' })));
	// Chi si sospende: non entra da 20 giorni, sarebbe assente.
	const fermo = await nuovoSocio('Sandro', 'Sospeso');
	await db.insert(subscriptions).values({ memberId: fermo.id, planName: 'Mensile', startDate: fra(-30), endDate: fra(28) });
	await db.insert(ingressi).values({ memberId: fermo.id, entratoAlle: new Date(`${fra(-20)}T08:00:00Z`), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Verifica' });
	// Chi torna dal tornello dopo un mese.
	const tornato = await nuovoSocio('Tea', 'Tornata');
	await db.insert(subscriptions).values({ memberId: tornato.id, planName: 'Annuale', startDate: '2025-01-01', endDate: fra(200) });
	await db.insert(ingressi).values([
		{ memberId: tornato.id, entratoAlle: new Date(`${fra(-31)}T08:00:00Z`), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Tornello' },
		{ memberId: tornato.id, entratoAlle: new Date(), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Tornello' },
	]);
	// L'istruttore: una lezione ieri del suo corso, con Paolo presente e Nino no; Olga a un altro corso.
	const presente = await nuovoSocio('Paolo', 'Presente');
	const assente = await nuovoSocio('Nino', 'Noshow');
	const altrove = await nuovoSocio('Olga', 'Altrove');
	const [mio, altro] = await db.insert(instructors).values([{ nome: 'Ilaria', cognome: `Istr${lettere}` }, { nome: 'Bruno', cognome: `Altro${lettere}` }]).returning();
	id.istruttori = [mio.id, altro.id];
	const [sala] = await db.insert(rooms).values({ name: `Sala V3 ${t}` }).returning();
	id.sala = sala.id;
	const corsi = await db.insert(courses).values([{ name: `Pilates V3 ${lettere}`, instructorId: mio.id }, { name: `Boxe V3 ${lettere}`, instructorId: altro.id }]).returning();
	id.corsi = corsi.map((c) => c.id);
	const eventi = await db.insert(events).values(corsi.map((c) => ({ courseId: c.id, roomId: sala.id, capacity: 8, recurrenceType: 'single', startDate: fra(-1), startTime: '18:00', endTime: '19:00' }))).returning();
	id.eventi = eventi.map((e) => e.id);
	const lezioni = await db.insert(sessions).values(eventi.map((e) => ({ eventId: e.id, date: fra(-1), startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 8 }))).returning();
	id.lezioni = lezioni.map((l) => l.id);
	await db.insert(bookings).values([
		{ sessionId: lezioni[0].id, memberId: presente.id, memberName: 'Paolo', status: 'confirmed' },
		{ sessionId: lezioni[0].id, memberId: assente.id, memberName: 'Nino', status: 'confirmed' },
		{ sessionId: lezioni[1].id, memberId: altrove.id, memberName: 'Olga', status: 'confirmed' },
	]);
	await db.insert(ingressi).values({ memberId: presente.id, entratoAlle: new Date(`${fra(-1)}T17:30:00+01:00`), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Tornello' });

	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception V3', email: `v3.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Ilaria Istr', email: `v3.istruttore.${t}@test.local`, passwordHash, ruolo: 'istruttore', instructorId: mio.id },
		{ nome: 'Rita Rinnovo', email: rinnova.email, passwordHash, ruolo: 'member', linkedMemberId: rinnova.id },
	]).returning();
	id.account = account.map((a) => a.id);
	const [reception, istruttore] = account;

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
	};
	const senzaScorrimento = async (p, nome) => {
		const larghezza = await p.evaluate(() => document.documentElement.scrollWidth);
		controlla(`${nome}: niente scorrimento orizzontale a 390 px`, larghezza <= 390, `${larghezza}px`);
	};

	// --- 1. Iscrivi, da un contatto, in un'unica finestra ---------------------------------
	console.log('\nISCRIVI');
	const staff = await nuovaPagina();
	await entra(staff, '/lead', reception.email);
	await staff.getByRole('button', { name: `Iscrivi Lucia Nuova${lettere}` }).click();
	await staff.locator('#anag-cf').fill(CF);
	await staff.locator('#anag-nascita').fill('1990-01-01');
	await staff.getByRole('combobox', { name: 'Sesso' }).click();
	await staff.getByRole('option', { name: 'F', exact: false }).first().click();
	await staff.screenshot({ path: schermata('iscrivi-anagrafica') });
	await staff.getByRole('button', { name: 'Avanti' }).click();
	await staff.getByRole('combobox', { name: 'Tipo di abbonamento' }).click();
	await staff.getByRole('option', { name: new RegExp(`Trimestrale ${lettere}`) }).click();
	await staff.getByText(/Scade il/).waitFor();
	await staff.getByRole('button', { name: 'Avanti' }).click();
	const certificato = path.join(os.tmpdir(), `certificato-${t}.png`);
	// Un PNG di un pixel: il server controlla che il contenuto sia davvero un'immagine.
	fs.writeFileSync(certificato, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
	await staff.locator('#iscrivi-certificato').setInputFiles(certificato);
	await staff.getByRole('button', { name: 'Avanti' }).click();
	await staff.getByRole('checkbox', { name: 'Informativa privacy firmata' }).click();
	await staff.getByRole('checkbox', { name: 'Email promozionali' }).click();
	await staff.getByRole('button', { name: 'Avanti' }).click();
	const password = (await staff.locator('p.font-mono').innerText()).trim();
	await staff.screenshot({ path: schermata('iscrivi-portale') });
	await staff.getByRole('button', { name: 'Iscrivi', exact: true }).click();
	await staff.waitForURL('**/crm/soci/**', { timeout: 15000 });
	const [lucia] = await db.select().from(members).where(eq(members.personaId, personaLead.id));
	if (lucia) id.soci.push(lucia.id);
	const [abbonamento] = lucia ? await db.select().from(subscriptions).where(eq(subscriptions.memberId, lucia.id)) : [];
	const [documento] = lucia ? await db.select().from(memberDocuments).where(eq(memberDocuments.memberId, lucia.id)) : [];
	const [accesso] = lucia ? await db.select().from(staffAccounts).where(eq(staffAccounts.linkedMemberId, lucia.id)) : [];
	if (documento?.fileUrl) id.file.push(documento.fileUrl);
	controlla('Iscrivi: nasce il socio, sulla persona del contatto', lucia?.codiceFiscale === CF);
	controlla('Iscrivi: con l\'abbonamento scelto', abbonamento?.planId === tipo.id, abbonamento?.endDate);
	controlla('Iscrivi: con il certificato', documento?.documentType === 'certificato_medico');
	controlla('Iscrivi: con l\'accesso al portale, da cambiare al primo accesso', accesso?.passwordDaCambiare === true && password.length >= 8);
	controlla('Iscrivi: con l\'informativa privacy', lucia?.gdprConsent === true);
	await staff.getByText('Diventato socio').first().waitFor();
	await staff.screenshot({ path: schermata('iscrivi-scheda'), fullPage: true });

	// --- 2. Richiedi il rinnovo dal portale -----------------------------------------------
	console.log('\nRICHIEDI IL RINNOVO');
	const portale = await nuovaPagina({ width: 390, height: 844 });
	await entra(portale, '/member-portal/abbonamento', rinnova.email);
	await portale.getByRole('button', { name: 'Richiedi il rinnovo' }).click();
	await portale.getByText('Richiesta di rinnovo inviata').waitFor();
	controlla('Portale: il socio vede che la richiesta è arrivata', await portale.getByText('Richiesta di rinnovo inviata').isVisible());
	await portale.screenshot({ path: schermata('portale-rinnovo'), fullPage: true });
	await senzaScorrimento(portale, 'Portale');

	const telefono = await nuovaPagina({ width: 390, height: 844 });
	await entra(telefono, '/oggi', reception.email);
	await telefono.getByRole('heading', { name: 'Oggi' }).waitFor();
	const primo = telefono.locator('ol > li').first();
	await primo.waitFor();
	controlla('Oggi: chi ha chiesto il rinnovo è in cima', (await primo.innerText()).includes(`Rita Rinnovo${lettere}`), await primo.innerText());
	controlla('Oggi: con il perché', /Chiede di rinnovare/.test(await primo.innerText()));
	// Chi è entrato dal tornello dopo un mese: in cima, prima della lista.
	const entrati = telefono.locator('section', { has: telefono.getByRole('heading', { name: 'Entrati oggi' }) });
	controlla('Oggi: "Entrati oggi" con il bentornato per chi è passato dal tornello', /Bentornato: non veniva da 31 giorni/.test(await entrati.innerText().catch(() => '')), await entrati.innerText().catch(() => 'assente'));
	await senzaScorrimento(telefono, 'Oggi');
	await telefono.screenshot({ path: schermata('oggi-telefono'), fullPage: true });
	await primo.getByRole('button', { name: 'Registra contatto' }).click();
	const dialogo = telefono.getByRole('dialog');
	await dialogo.getByRole('button', { name: 'Ha risposto', exact: true }).click();
	await dialogo.getByRole('button', { name: 'Registra' }).click();
	await telefono.waitForTimeout(1200);
	controlla('Oggi: registrato il contatto, la richiesta sparisce', await telefono.locator('ol > li', { hasText: `Rita Rinnovo${lettere}` }).count() === 0);
	await entrati.getByRole('button', { name: 'Salutato' }).click();
	await telefono.getByText('Nel diario').waitFor();
	controlla('Oggi: il bentornato si segna nel diario con un tocco', true);

	// --- 3. La sospensione ----------------------------------------------------------------
	console.log('\nSOSPENSIONE');
	await staff.goto(`${BASE}/crm/soci/${fermo.id}`, { waitUntil: 'networkidle' });
	controlla('Scheda: prima della sospensione è assente', await staff.getByText('Non viene da un po\'').first().isVisible().catch(() => false));
	await staff.getByRole('button', { name: 'Sospendi abbonamento' }).click();
	await staff.locator('#sosp-ripresa').fill(fra(14));
	await staff.locator('#sosp-nota').fill('Infortunio al ginocchio');
	await staff.getByRole('button', { name: 'Sospendi', exact: true }).click();
	await staff.getByText('+14 giorni di sospensione').waitFor();
	const testoScheda = await staff.locator('body').innerText();
	const scadenzaAttesa = fra(42).split('-').reverse().join('/');
	controlla('Sospensione: la scadenza slitta di 14 giorni', (await db.select().from(subscriptions).where(eq(subscriptions.memberId, fermo.id)))[0].endDate === fra(28)
		&& (await (await fetch(`${BASE}/api/segnali?persona=${fermo.personaId}`, { headers: { authorization: `Bearer ${await staff.evaluate(() => localStorage.getItem('grip_staff_token'))}` } })).json()).persone[0].scadenza === fra(42), scadenzaAttesa);
	controlla('Sospensione: la fase è "Sospeso", non assente', /Sospeso/.test(testoScheda) && !/Non viene da un po'/.test(testoScheda));
	controlla('Sospensione: nel diario, con il motivo', /Abbonamento sospeso dal/.test(testoScheda) && /Infortunio al ginocchio/.test(testoScheda));
	await staff.screenshot({ path: schermata('sospensione-scheda'), fullPage: true });
	await staff.goto(`${BASE}/oggi`, { waitUntil: 'networkidle' });
	await staff.getByRole('heading', { name: 'Oggi' }).waitFor();
	await staff.waitForTimeout(500);
	controlla('Oggi: il socio sospeso non c\'è', await staff.locator('li', { hasText: `Sandro Sospeso${lettere}` }).count() === 0);

	// --- 4. La vista istruttore -----------------------------------------------------------
	console.log('\nISTRUTTORE');
	const lezione = await nuovaPagina({ width: 390, height: 844 });
	await entra(lezione, '/istruttore', istruttore.email);
	await lezione.getByRole('heading', { name: 'Le mie lezioni' }).waitFor();
	await lezione.waitForTimeout(800);
	// Le lezioni di ieri non sono "da oggi": si guarda dal giorno prima.
	await lezione.evaluate(() => {});
	const dati = await lezione.evaluate(async (dal) => {
		const h = { authorization: `Bearer ${localStorage.getItem('grip_staff_token')}` };
		return (await fetch(`/api/istruttore/lezioni?dal=${dal}`, { headers: h })).json();
	}, fra(-1));
	const ieri = dati.lezioni?.find((l) => l.data === fra(-1));
	const esitoDi = (s) => ieri?.prenotati.find((p) => p.socio_id === s.id)?.esito;
	controlla('Istruttore: presente chi è entrato, no-show chi no', esitoDi(presente) === 'presente' && esitoDi(assente) === 'no_show', JSON.stringify(ieri?.prenotati?.map((p) => p.esito)));
	controlla('Istruttore: il socio di un altro corso non c\'è', !JSON.stringify(dati).includes(altrove.id));
	await lezione.getByRole('tab', { name: 'Ultimi 7 giorni' }).click();
	await lezione.getByText(`Pilates V3 ${lettere}`).first().waitFor();
	const scheda = await lezione.locator('li', { hasText: `Pilates V3 ${lettere}` }).innerText();
	controlla('Istruttore: nella pagina, "Presente" e "Non è venuto"', /Presente/.test(scheda) && /Non è venuto/.test(scheda) && /1 su 2 presenti/.test(scheda), scheda);
	await lezione.screenshot({ path: schermata('istruttore-telefono'), fullPage: true });
	await senzaScorrimento(lezione, 'Le mie lezioni');
	const vietata = await lezione.evaluate(async (persona) => {
		const h = { authorization: `Bearer ${localStorage.getItem('grip_staff_token')}` };
		return Promise.all([`/api/segnali`, `/api/persone/${persona}/diario`, '/api/lead/lavoro'].map(async (u) => (await fetch(u, { headers: h })).status));
	}, altrove.personaId);
	controlla('Istruttore: Oggi, diario e contatti gli sono chiusi', vietata.every((s) => s === 403), vietata.join(','));

	// --- 5. La dashboard ------------------------------------------------------------------
	await staff.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await staff.getByRole('heading', { name: 'Dashboard' }).waitFor();
	await staff.screenshot({ path: schermata('dashboard'), fullPage: true });

	controlla('Nessun errore JavaScript nelle pagine', errori.length === 0, errori.join(' | '));
} catch (errore) {
	controlla('Il giro arriva in fondo', false, errore.message);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	// Pulizia, dal più dipendente.
	if (id.lezioni) await db.delete(bookings).where(inArray(bookings.sessionId, id.lezioni));
	if (id.eventi) { await db.delete(sessions).where(inArray(sessions.eventId, id.eventi)); await db.delete(events).where(inArray(events.id, id.eventi)); }
	if (id.corsi) await db.delete(courses).where(inArray(courses.id, id.corsi));
	if (id.sala) await db.delete(rooms).where(eq(rooms.id, id.sala));
	if (id.account.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	if (id.soci.length) {
		await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, id.soci));
		for (const tabella of [ingressi, subscriptions, memberDocuments, sospensioni]) await db.delete(tabella).where(inArray(tabella.memberId, id.soci));
		await db.delete(bookings).where(inArray(bookings.memberId, id.soci));
		await db.delete(auditLogs).where(inArray(auditLogs.entitaId, id.soci));
		await db.delete(members).where(inArray(members.id, id.soci));
	}
	if (id.istruttori) await db.delete(instructors).where(inArray(instructors.id, id.istruttori));
	if (id.persone.length) {
		await db.delete(consensi).where(inArray(consensi.personaId, id.persone));
		await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
		await db.delete(trattative).where(inArray(trattative.personaId, id.persone));
		await db.delete(persone).where(inArray(persone.id, id.persone));
	}
	if (id.canale) await db.delete(canaliContatto).where(eq(canaliContatto.id, id.canale));
	if (id.tipo) await db.delete(plans).where(eq(plans.id, id.tipo));
	// L'iscrizione ha consumato un codice socio: il contatore torna dov'era.
	if (contatore) await db.update(numberingCounters).set({ value: contatore.value }).where(and(eq(numberingCounters.organizationId, contatore.organizationId), eq(numberingCounters.scope, 'codice_socio')));
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli superati. Schermate in ${os.tmpdir()}`);
process.exit(falliti ? 1 : 0);
