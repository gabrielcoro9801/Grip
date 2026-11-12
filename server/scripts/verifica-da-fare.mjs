/**
 * Da fare, gli stati, l'elenco dei soci, i consensi: provati in un browser vero, con le schermate
 * nella cartella temporanea.
 *
 * - Da fare: la barra con i numeri, una scheda per avviso con le sue azioni, i recapiti senza link,
 *   Nascondi e poi Ripristina dall'Archivio.
 * - La scheda socio: lo stato in testa, niente blocco "Da seguire", i consensi in sola lettura.
 * - Elenco soci: le colonne nuove, "Contatta" da tabella e tile (senza aprire la scheda).
 * - La dashboard: cinque tessere, una per avviso, con i numeri di Da fare.
 * - Le Regole: /admin/da-fare porta lì, un numero cambia la regola mentre si scrive, un avviso si
 *   spegne e sparisce; solo per l'amministratore, come il link della legenda degli stati.
 * - Da telefono, 390 px: nessuna scheda scorre di lato.
 * - Il portale: la domanda sui consensi al primo accesso; togliere un consenso, con "Annulla";
 *   niente più richiesta di rinnovo.
 *
 * Come si usa:
 *   1. npx vite build        (nella radice: questo script serve il build corrente)
 *   2. cd server && npm run verifica:da-fare
 *
 * Richiede un PostgreSQL raggiungibile, come i test: crea i suoi dati, rimette le impostazioni
 * com'erano e cancella tutto alla fine.
 */
import bcrypt from 'bcryptjs';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, attivita, consensi, organizations, memberDocuments, ingressi, auditLogs, avvisi,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import os from 'node:os';
import path from 'node:path';

const PASSWORD = 'verifica-da-fare-1234';
const PORTA = 4610;
const BASE = `http://127.0.0.1:${PORTA}`;
const t = Date.now();
const inizio = new Date();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);
const dataIt = (iso) => iso.split('-').reverse().join('/');
const schermata = (nome) => path.join(os.tmpdir(), `verifica-da-fare-${nome}.png`);
// Le schede, nell'ordine della barra.
const SCHEDE = [
	['In scadenza', '/da-fare', 'in_scadenza'],
	['Scaduti', '/da-fare/scaduti', 'scaduto'],
	['Frequenza', '/da-fare/frequenza', 'frequenza'],
	['Documenti', '/da-fare/documenti', 'documento'],
	['Compleanni', '/da-fare/compleanni', 'compleanno'],
];

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
	// Un compleanno lontano per tutti, tranne Giulia che lo compie oggi (1992: il 29 febbraio c'è).
	const lontano = `1992-${fra(180).slice(5)}`;
	const persone = [
		// Scade fra 3 giorni: In scadenza.
		{ nome: 'Marco', cognome: `Rinnovi${lettere}`, fine: fra(3), ingresso: 2 },
		// Certificato scaduto: Documenti.
		{ nome: 'Sara', cognome: `Documenti${lettere}`, fine: fra(200), ingresso: 2, certificato: fra(-5) },
		// Non entra da 20 giorni: Frequenza, e stato "In calo".
		{ nome: 'Luca', cognome: `Assente${lettere}`, fine: fra(200), ingresso: 20 },
		// Per il portale: tutto in regola, mai scelto i consensi.
		{ nome: 'Elena', cognome: `Portale${lettere}`, fine: fra(200), ingresso: 1 },
		// Scaduto da 5 giorni: Scaduti.
		{ nome: 'Paolo', cognome: `Scaduto${lettere}`, fine: fra(-5), ingresso: 6 },
		// Compie gli anni oggi: Compleanni.
		{ nome: 'Giulia', cognome: `Compleanno${lettere}`, fine: fra(200), ingresso: 1, nascita: `1992-${oggi.slice(5)}` },
	];
	const soci = await db.insert(members).values(persone.map((p, i) => ({
		nome: p.nome, cognome: p.cognome, codiceSocio: `VD${i}${lettere}`, email: `${p.nome.toLowerCase()}.${t}@test.local`,
		phone: `+3934700000${i}${String(t).slice(-1)}`, dateOfBirth: p.nascita ?? lontano,
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
	const [marco, sara, luca, elena, paolo, giulia] = soci;
	const nome = (s) => `${s.nome} ${s.cognome}`;
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
	const vai = (p, url) => p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
	// Una scheda di Da fare, o una riga dell'Archivio: il <li> con il nome del socio.
	const riga = (p, s) => p.locator('li').filter({ has: p.getByRole('link', { name: nome(s) }) });
	const api = (p, url) => p.evaluate(async (u) => {
		const res = await fetch(u, { headers: { authorization: `Bearer ${localStorage.getItem('grip_staff_token')}` } });
		return res.json();
	}, url);
	// La barra: [{ etichetta, numero }], il numero null se non c'è.
	const barra = async (p) => {
		const voci = await p.getByRole('navigation', { name: 'Schede di Da fare' }).getByRole('link').allInnerTexts();
		return voci.map((v) => {
			const [, etichetta, numero] = v.replace(/\s+/g, ' ').trim().match(/^(.*?)\s*(\d+)?$/);
			return { etichetta, numero: numero === undefined ? null : Number(numero) };
		});
	};
	const rigaDb = async (s, tipo) => (await db.select().from(avvisi).where(and(eq(avvisi.personaId, s.personaId), eq(avvisi.tipo, tipo))))[0];

	// --- 1. Da fare: la barra e le cinque schede ---------------------------------------------------
	console.log('\nDA FARE');
	const pg = await nuovaPagina();
	await entra(pg, '/da-fare', reception.email);
	await pg.getByRole('heading', { name: 'Abbonamenti in scadenza' }).waitFor();
	controlla('Il menu dice "Da fare"', await pg.getByRole('link', { name: 'Da fare' }).first().isVisible());
	// I numeri arrivano con la prima lista.
	const rigaMarco = riga(pg, marco);
	await rigaMarco.waitFor();
	const voci = await barra(pg);
	controlla('La barra: le cinque schede e l\'Archivio, senza Regole per la reception',
		voci.map((v) => v.etichetta).join('|') === 'In scadenza|Scaduti|Frequenza|Documenti|Compleanni|Archivio', JSON.stringify(voci));
	const { conteggi } = await api(pg, '/api/avvisi?tipo=compleanno');
	controlla('La barra: accanto a ogni scheda il numero degli avvisi aperti',
		SCHEDE.every(([etichetta, , tipo]) => voci.find((v) => v.etichetta === etichetta)?.numero === conteggi[tipo]), JSON.stringify({ voci, conteggi }));

	// In scadenza: Rinnova, Non rinnova, i recapiti.
	controlla('In scadenza: Marco, con la data e "tra 3 giorni"', (await rigaMarco.innerText()).includes(`Abbonamento in scadenza il ${dataIt(fra(3))} · tra 3 giorni`), await rigaMarco.innerText());
	controlla('In scadenza: Sara non c\'è', await riga(pg, sara).count() === 0);
	controlla('In scadenza: "Rinnova", "Non rinnova", "Nascondi avviso"',
		await rigaMarco.getByRole('button', { name: 'Rinnova', exact: true }).isVisible()
		&& await rigaMarco.getByRole('button', { name: 'Non rinnova', exact: true }).isVisible()
		&& await rigaMarco.getByRole('button', { name: 'Nascondi avviso' }).isVisible());
	await pg.screenshot({ path: schermata('1-in-scadenza'), fullPage: true });
	// Una finestra si apre, si guarda e si chiude: la pagina sotto torna cliccabile.
	const apriEChiudi = async (pulsante, titolo) => {
		await pulsante.click();
		const finestra = pg.getByRole('dialog');
		const aperta = await finestra.getByRole('heading', { name: titolo }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
		await pg.keyboard.press('Escape');
		await finestra.waitFor({ state: 'detached' });
		return aperta;
	};
	controlla('Rinnova apre la vendita, senza uscire', await apriEChiudi(rigaMarco.getByRole('button', { name: 'Rinnova', exact: true }), 'Vendi un abbonamento') && pg.url().endsWith('/da-fare'));
	controlla('Non rinnova chiede "Perché se ne va?"', await apriEChiudi(rigaMarco.getByRole('button', { name: 'Non rinnova', exact: true }), 'Perché se ne va?'));
	await rigaMarco.getByRole('button', { name: `Recapiti di ${nome(marco)}` }).click();
	const recapiti = pg.getByRole('dialog');
	await recapiti.getByRole('heading', { name: `Recapiti di ${nome(marco)}` }).waitFor();
	controlla('I recapiti: in chiaro, con "Copia", senza link', await recapiti.getByRole('link').count() === 0
		&& await recapiti.getByRole('button', { name: /^Copia/ }).count() >= 1 && (await recapiti.innerText()).includes(marco.email), await recapiti.innerText());
	await pg.screenshot({ path: schermata('2-recapiti') });
	await pg.keyboard.press('Escape');
	await recapiti.waitFor({ state: 'detached' });

	// Scaduti: Nascondi.
	await vai(pg, '/da-fare/scaduti');
	const rigaPaolo = riga(pg, paolo);
	await rigaPaolo.waitFor();
	controlla('Scaduti: Paolo, "5 giorni fa"', (await rigaPaolo.innerText()).includes(`Abbonamento scaduto il ${dataIt(fra(-5))} · 5 giorni fa`), await rigaPaolo.innerText());
	await rigaPaolo.getByRole('button', { name: 'Nascondi avviso' }).click();
	await rigaPaolo.waitFor({ state: 'detached' });
	controlla('Nascondi: Paolo esce dalla scheda', (await rigaDb(paolo, 'scaduto'))?.esito === 'nascosto');

	// Frequenza: Contattato.
	await vai(pg, '/da-fare/frequenza');
	const rigaLuca = riga(pg, luca);
	await rigaLuca.waitFor();
	controlla('Frequenza: Luca, con la media e gli ingressi', /Frequenza media ogni 4 settimane: .* · Entrate nelle ultime 4 settimane: \d+/.test(await rigaLuca.innerText()), await rigaLuca.innerText());
	await pg.screenshot({ path: schermata('3-frequenza'), fullPage: true });
	await rigaLuca.getByRole('button', { name: 'Contattato', exact: true }).click();
	await rigaLuca.waitFor({ state: 'detached' });
	const [contatto] = (await db.select().from(attivita).where(eq(attivita.personaId, luca.personaId))).filter((r) => r.tipo === 'contatto');
	controlla('Contattato: Luca esce, e nel diario un contatto per "assente"',
		(await rigaDb(luca, 'frequenza'))?.esito === 'contattato' && contatto?.riferimento?.segnali?.includes('assente'), JSON.stringify(contatto?.riferimento));

	// Documenti: Carica documento, con il tipo già scelto.
	await vai(pg, '/da-fare/documenti');
	const rigaSara = riga(pg, sara);
	await rigaSara.waitFor();
	controlla('Documenti: Sara, certificato scaduto', (await rigaSara.innerText()).includes(`Certificato medico scaduto il ${dataIt(fra(-5))}`), await rigaSara.innerText());
	controlla('Carica documento: il caricamento del certificato, senza uscire', await apriEChiudi(rigaSara.getByRole('button', { name: 'Carica documento' }), /^Carica — Certificato medico/));

	// Compleanni: Auguri fatti.
	await vai(pg, '/da-fare/compleanni');
	const rigaGiulia = riga(pg, giulia);
	await rigaGiulia.waitFor();
	controlla('Compleanni: Giulia, oggi', (await rigaGiulia.innerText()).includes(`Compleanno il ${dataIt(oggi).slice(0, 5)} · oggi`), await rigaGiulia.innerText());
	await rigaGiulia.getByRole('button', { name: 'Auguri fatti' }).click();
	await rigaGiulia.waitFor({ state: 'detached' });
	controlla('Auguri fatti: Giulia esce dalla scheda', (await rigaDb(giulia, 'compleanno'))?.esito === 'auguri_fatti');

	// L'Archivio: Paolo nascosto, e Ripristina.
	await vai(pg, '/da-fare/archivio?tipo=scaduto');
	await pg.getByRole('heading', { name: 'Archivio' }).waitFor();
	controlla('L\'Archivio ha la seconda fila delle cinque schede', (await pg.getByRole('tab').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').trim()).join('|') === 'In scadenza|Scaduti|Frequenza|Documenti|Compleanni');
	const archiviato = riga(pg, paolo);
	await archiviato.waitFor();
	controlla('Archivio › Scaduti: Paolo, «Nascosto», da Rocco', /Nascosto · Rocco Reception/.test(await archiviato.innerText()), await archiviato.innerText());
	await pg.screenshot({ path: schermata('4-archivio'), fullPage: true });
	await archiviato.getByRole('button', { name: 'Ripristina' }).click();
	await pg.getByText(`${nome(paolo)}: avviso ripristinato`).first().waitFor();
	await archiviato.waitFor({ state: 'detached' });
	await vai(pg, '/da-fare/scaduti');
	await riga(pg, paolo).waitFor();
	controlla('Ripristina: Paolo torna in Scaduti', (await rigaDb(paolo, 'scaduto'))?.chiusoIl === null);
	await vai(pg, '/da-fare/archivio?tipo=frequenza');
	await riga(pg, luca).waitFor();
	controlla('Archivio › Frequenza: Luca, «Contattato»', /Contattato · Rocco Reception/.test(await riga(pg, luca).innerText()));

	// --- 2. La scheda socio --------------------------------------------------------------------
	console.log('\nSCHEDA');
	await vai(pg, `/crm/soci/${luca.id}`);
	await pg.getByRole('heading', { name: nome(luca) }).waitFor();
	controlla('In testa lo stato: In calo', await pg.getByText('In calo', { exact: true }).first().isVisible());
	controlla('Niente blocco "Da seguire"', await pg.getByText('Da seguire', { exact: true }).count() === 0);
	controlla('Niente "Registra contatto" né "Rimanda"', await pg.getByRole('button', { name: /Registra contatto|Rimanda/ }).count() === 0);
	controlla('Il diario racconta il Contattato', await pg.getByText(/Fatto:.*Non viene da un po'/).first().isVisible());
	const consensiCard = pg.locator('div').filter({ has: pg.getByText('Comunicazioni promozionali', { exact: true }) }).last();
	controlla('Consensi in sola lettura: niente caselle', await consensiCard.getByRole('checkbox').count() === 0);
	await pg.getByRole('button', { name: 'Registra consenso firmato' }).click();
	controlla('Senza modulo caricato, il consenso non si registra', await pg.getByText(/Prima carica il modulo firmato/).isVisible());
	controlla('…e "Registra" resta spento', await pg.getByRole('button', { name: 'Registra', exact: true }).isDisabled());
	await pg.screenshot({ path: schermata('5-scheda'), fullPage: true });
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
	// L'elenco è a pagine: si cerca il socio per nome, come fa la segreteria.
	await pg.getByLabel('Cerca un socio').fill(`Marco Rinnovi${lettere}`);
	await pg.getByRole('button', { name: `Contatta Marco Rinnovi${lettere}` }).click();
	const dialogo = pg.getByRole('dialog');
	controlla('Contatta: chiama, WhatsApp, SMS, email', (await dialogo.getByRole('link').allInnerTexts()).join(',').replace(/\s/g, '') === 'Chiama,WhatsApp,SMS,Email', await dialogo.innerText());
	await pg.screenshot({ path: schermata('6-contatta'), fullPage: true });
	await pg.keyboard.press('Escape');
	await pg.getByRole('button', { name: /Tile/ }).click();
	await pg.getByLabel('Cerca un socio').fill(`Sara Documenti${lettere}`);
	await pg.getByRole('button', { name: `Contatta Sara Documenti${lettere}` }).click();
	// La ricerca sta nell'indirizzo (`?q=`): conta che non si sia aperta la scheda.
	controlla('Contatta dalla tile non apre la scheda', !pg.url().includes('/crm/soci/') && await pg.getByRole('dialog').isVisible(), pg.url());
	await pg.keyboard.press('Escape');

	// --- 4. La dashboard ---------------------------------------------------------------------------
	console.log('\nDASHBOARD');
	await vai(pg, '/');
	const tessere = pg.locator('section[aria-labelledby="dashboard-da-fare"]').getByRole('link');
	await tessere.first().waitFor();
	const testi = (await tessere.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
	const { da_fare: daFare } = await api(pg, '/api/dashboard');
	controlla('Cinque tessere, una per avviso, con i numeri di Da fare',
		testi.length === 5 && SCHEDE.every(([etichetta, , tipo], i) => testi[i] === `${etichetta} ${daFare[tipo]}`), JSON.stringify({ testi, daFare }));
	controlla('Niente più liste doppie', await pg.getByText('Avvisi certificati').count() === 0 && await pg.getByText('Rinnovi abbonamenti').count() === 0);
	await pg.screenshot({ path: schermata('7-dashboard'), fullPage: true });
	await tessere.filter({ hasText: 'Scaduti' }).click();
	await pg.waitForURL(/\/da-fare\/scaduti$/);
	await vai(pg, '/');
	await tessere.filter({ hasText: 'In scadenza' }).click();
	await pg.waitForURL(/\/da-fare$/);
	controlla('Un clic porta alla scheda', true);

	// --- 5. Le Regole ---------------------------------------------------------------------------------
	console.log('\nREGOLE');
	const am = await nuovaPagina();
	await entra(am, '/admin/da-fare', admin.email);
	await am.waitForURL(/\/da-fare\/regole$/);
	await am.getByRole('heading', { name: 'Regole', exact: true }).waitFor();
	controlla('/admin/da-fare porta a /da-fare/regole', true);
	controlla('L\'amministratore ha la voce Regole nella barra', (await barra(am)).at(-1)?.etichetta === 'Regole');
	const riapri = am.getByLabel('Ricompare dopo quanti giorni');
	await riapri.fill('31');
	controlla('La regola si riscrive mentre si cambia il numero', await am.getByText(/torna dopo 31 giorni, se è ancora in calo/).isVisible());
	await am.getByRole('checkbox', { name: 'Segui «Documenti in scadenza»' }).click();
	await am.getByRole('button', { name: 'Salva' }).click();
	await am.getByText('Regole salvate').first().waitFor();
	const [salvata] = await db.select().from(organizations).where(eq(organizations.id, palestra.id));
	controlla('Salvate: il numero e l\'avviso spento', salvata.impostazioni?.soglie?.frequenzaRiapriGiorni === 31
		&& ['documento_scaduto', 'documento_in_scadenza'].every((c) => salvata.impostazioni?.segnali_spenti?.includes(c)), JSON.stringify(salvata.impostazioni?.segnali_spenti));
	const registro = await db.select().from(auditLogs).where(and(eq(auditLogs.entitaTipo, 'impostazioni'), gte(auditLogs.timestamp, inizio)));
	controlla('Nel registro delle azioni', registro.length >= 1);
	await am.screenshot({ path: schermata('8-regole'), fullPage: true });
	await am.reload({ waitUntil: 'networkidle' });
	await riapri.waitFor();
	controlla('Ricaricando restano', await riapri.inputValue() === '31'
		&& await am.getByRole('checkbox', { name: 'Segui «Documenti in scadenza»' }).getAttribute('data-state') === 'unchecked');
	await vai(pg, '/da-fare/documenti');
	await pg.getByText('La palestra non segue questo avviso').waitFor();
	controlla('L\'avviso spento sparisce da Da fare', await riga(pg, sara).count() === 0
		&& (await barra(pg)).find((v) => v.etichetta === 'Documenti')?.numero === 0);
	await vai(pg, '/da-fare/regole');
	controlla('La reception non apre le Regole', pg.url().endsWith('/da-fare'), pg.url());
	// La legenda degli stati: il link alle Regole solo per l'amministratore.
	const legenda = async (p) => {
		await vai(p, '/crm');
		await p.getByRole('button', { name: /Tabella/ }).click();
		await p.getByRole('button', { name: 'Che cosa vogliono dire gli stati' }).click();
		await p.getByRole('heading', { name: 'Gli stati dei soci' }).waitFor();
		return p.getByRole('link', { name: 'Le soglie di «In calo» si cambiano nelle Regole di Da fare' });
	};
	controlla('Legenda: per la reception niente link alle Regole', await (await legenda(pg)).count() === 0);
	await pg.keyboard.press('Escape');
	await (await legenda(am)).click();
	await am.waitForURL(/\/da-fare\/regole$/);
	controlla('Legenda: l\'amministratore va alle Regole', true);

	// --- 6. Da telefono ------------------------------------------------------------------------------
	console.log('\nTELEFONO');
	const tel = await nuovaPagina({ width: 390, height: 844 });
	await entra(tel, '/da-fare', reception.email);
	await riga(tel, marco).waitFor();
	await tel.screenshot({ path: schermata('9-telefono'), fullPage: true });
	const larghe = [];
	for (const [, percorso] of [...SCHEDE, ['', '/da-fare/archivio']]) {
		await vai(tel, percorso);
		const larghezza = await tel.evaluate(() => document.documentElement.scrollWidth);
		if (larghezza > 390) larghe.push(`${percorso}: ${larghezza}px`);
	}
	await vai(tel, '/');
	const dashboard = await tel.evaluate(() => document.documentElement.scrollWidth);
	if (dashboard > 390) larghe.push(`/: ${dashboard}px`);
	controlla('Da telefono le schede, l\'Archivio e la dashboard non scorrono di lato', larghe.length === 0, larghe.join(', '));
	const telAm = await nuovaPagina({ width: 390, height: 844 });
	await entra(telAm, '/da-fare/regole', admin.email);
	await telAm.getByRole('heading', { name: 'Regole', exact: true }).waitFor();
	const regole = await telAm.evaluate(() => document.documentElement.scrollWidth);
	controlla('Da telefono le Regole non scorrono di lato', regole <= 390, `${regole}px`);

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
	await portale.screenshot({ path: schermata('10-portale'), fullPage: true });
	await portale.getByRole('button', { name: 'Annulla' }).click();
	await portale.getByText(/^Tolto:/).waitFor({ state: 'detached' });
	const ridato = await portale.waitForFunction(() => document.querySelector('[role=checkbox]')?.getAttribute('data-state') === 'checked', null, { timeout: 5000 }).then(() => true, () => false);
	controlla('"Annulla" lo ridà', ridato);
	await portale.goto(`${BASE}/member-portal/abbonamento`, { waitUntil: 'networkidle' });
	await portale.getByRole('heading', { name: 'Abbonamento' }).waitFor();
	controlla('Abbonamento: niente richiesta di rinnovo', await portale.getByText(/Richiedi il rinnovo|Vuoi rinnovare/).count() === 0);

	controlla('Nessun errore JavaScript', errori.length === 0, errori.join(' | '));
} catch (errore) {
	controlla('La verifica arriva in fondo', false, errore.message);
} finally {
	if (browser) await browser.close();
	if (app) await app.close();
	if (id.persone.length) {
		await db.delete(avvisi).where(inArray(avvisi.personaId, id.persone));
		await db.delete(consensi).where(inArray(consensi.personaId, id.persone));
		await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
	}
	if (id.account.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	if (id.soci.length) {
		await db.delete(ingressi).where(inArray(ingressi.memberId, id.soci));
		await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, id.soci));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
		await db.delete(members).where(inArray(members.id, id.soci));
		await db.delete(persone).where(inArray(persone.id, id.persone));
	}
	// Solo le voci del registro scritte da questa verifica.
	await db.delete(auditLogs).where(and(eq(auditLogs.entitaTipo, 'impostazioni'), gte(auditLogs.timestamp, inizio)));
	await db.update(organizations).set({ impostazioni: impostazioniPrima }).where(eq(organizations.id, palestra.id));
	await pool.end();
}

const falliti = esiti.filter((e) => !e.ok).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} controlli passati. Schermate: ${path.join(os.tmpdir(), 'verifica-da-fare-*.png')}`);
process.exit(falliti ? 1 : 0);
