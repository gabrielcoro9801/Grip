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
import { eq, and, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { enteDellaNumerazione } from '../src/lib/codiceSocio.js';
import {
	members, staffAccounts, subscriptions, memberDocuments, qrAccessi,
	rooms, courses, categories, events, sessions, bookings,
	persone, trattative, attivita, consensi, canaliContatto, numberingCounters, auditLogs,
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
// Corsi si apre sui giorni, da oggi; la lezione seminata è fra tre giorni. Nella vista "Per
// corso" ci sono le categorie: si pretende che i dati dell'agenda siano arrivati e disegnati.
// La lezione, prenotata, la mostra la home fra "Le tue prossime lezioni".
const CATEGORIA = `Categoria Verifica ${suffisso}`;
const NOME_SOCIO = 'Socio Giro Pagine';
// Senza cifre: il contatore dei codici veri prende il massimo delle cifre, e un codice di prova
// numerico lo farebbe saltare in avanti.
const CODICE_SOCIO = `GP${String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`;
// Un contatto e il suo canale: si pretende di rivederli nelle tre pagine dei lead, e poi il
// contatto si trasforma in socio dal browser.
const CANALE = `Canale Verifica ${suffisso}`;
const COGNOME_LEAD = `Contatto${suffisso}`;
const CF_LEAD = 'RSSMRA85T10A562S';

const PAGINE_STAFF = [
	['/', null], ['/crm', null], ['/crm/listino', null], ['/crm/venduti', null], ['/crm/ingressi', null],
	['/lead', COGNOME_LEAD], ['/lead/andamento', CANALE], ['/lead/canali', CANALE],
	['/calendario', null], ['/calendario/prenotazioni', null], ['/calendario/corsi', null],
	['/calendario/sale', null], ['/calendario/istruttori', null], ['/calendario/categorie', null],
	['/admin', null], ['/log-audit', null],
];

// Per il portale il controllo è più severo: ogni pagina deve mostrare un dato preciso.
const PAGINE_SOCIO = [
	['/member-portal', PIANO],
	['/member-portal', CORSO],
	['/member-portal/corsi', CATEGORIA, (p) => p.getByRole('tab', { name: 'Per corso' }).click()],
	['/member-portal/documenti', DOCUMENTO],
	['/member-portal/abbonamento', PIANO],
	['/member-portal/qr', NOME_SOCIO],
	['/member-portal/anagrafica', CODICE_SOCIO],
	['/member-portal/notifiche', 'Notifiche e avvisi'],
];

const SCHERMATA_ROTTA = /si è bloccata|Torna all'inizio/i;

const problemi = [];

async function apri(pagina, percorso, atteso, base, prima) {
	const errori = [];
	const ascoltatore = (e) => errori.push(e.message);
	pagina.on('pageerror', ascoltatore);

	await pagina.goto(`${base}${percorso}`, { waitUntil: 'networkidle' });
	await pagina.waitForTimeout(1400);
	if (prima) { await prima(pagina); await pagina.waitForTimeout(400); }
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
let idCanale;
let idLead;
let idPersonaLead;
let contatoreIniziale;
let idEnte;

const oggi = new Date().toISOString().split('T')[0];
const fraTreGiorni = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
const fraUnAnno = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];

try {
	const [socio] = await db
		.insert(members)
		.values({ nome: 'Socio', cognome: 'Giro Pagine', email: emailSocio, codiceSocio: CODICE_SOCIO, phone: '333 1234567' })
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
		.values({ memberId: socio.id, planName: PIANO, startDate: oggi, endDate: fraUnAnno, status: 'active' })
		.returning();
	idAbbonamenti.push(...abbonamenti.map((a) => a.id));

	const documenti = await db
		.insert(memberDocuments)
		.values({ memberId: socio.id, documentType: 'certificato_medico', fileName: 'certificato.pdf', expiryDate: fraUnAnno })
		.returning();
	idDocumenti.push(...documenti.map((d) => d.id));

	const qr = await db
		.insert(qrAccessi)
		.values({ clienteId: socio.id, clienteName: NOME_SOCIO, codice: `GRIP-VERI-PAGI-${suffisso}`.slice(0, 60), stato: 'attivo' })
		.returning();
	idQr.push(...qr.map((q) => q.id));

	const [sala] = await db.insert(rooms).values({ name: 'Sala Verifica' }).returning();
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

	const [canale] = await db.insert(canaliContatto).values({ nome: CANALE }).returning();
	idCanale = canale.id;
	// Un contatto è una persona con una trattativa (dalla migrazione 0051 la tabella `leads` non c'è più).
	const [personaLead] = await db.insert(persone).values({ nome: 'Lucia', cognome: COGNOME_LEAD, sesso: 'F', annoNascita: 1994 }).returning();
	idPersonaLead = personaLead.id;
	const [lead] = await db.insert(trattative).values({ personaId: personaLead.id, dataContatto: oggi, canaleId: canale.id }).returning();
	idLead = lead.id;

	// La trasformazione consuma un codice socio: a fine giro il contatore torna dov'era.
	// Lo stesso ente che userà il server per numerare.
	idEnte = await enteDellaNumerazione(db);
	if (idEnte) {
		const [c] = await db.select().from(numberingCounters)
			.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
		contatoreIniziale = c?.value ?? null;
	}

	app = buildApp({ logger: false });
	await app.listen({ port: PORTA, host: '127.0.0.1' });
	const BASE = `http://127.0.0.1:${PORTA}`;

	browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());

	console.log('\nGESTIONALE');
	const pagStaff = await (await browser.newContext()).newPage();
	await entra(pagStaff, BASE, '/', emailStaff);
	for (const [percorso, atteso] of PAGINE_STAFF) await apri(pagStaff, percorso, atteso, BASE);

	// Trasformare un contatto e correggere un'anagrafica: sono le due finestre in cui un
	// errore di validazione — un codice fiscale, un nome completo che non si ricalcola — non
	// si vede aprendo la pagina. Si fa il clic, e si guarda il database.
	console.log('\nLAVORARE UN CONTATTO (non solo aprirlo)');
	await pagStaff.goto(`${BASE}/lead`, { waitUntil: 'networkidle' });
	await pagStaff.waitForTimeout(1000);
	const riga = pagStaff.locator('tr', { hasText: COGNOME_LEAD });
	// "Trasforma in socio" è diventato Iscrivi, una finestra a passi (anagrafica, abbonamento,
	// certificato, privacy, portale): qui si fa il giro minimo, saltando i facoltativi.
	const trasforma = riga.getByRole('button', { name: `Iscrivi Lucia ${COGNOME_LEAD}` });
	let socioCreato = null;
	if (await trasforma.count()) {
		await trasforma.click();
		const finestra = pagStaff.getByRole('dialog');
		await finestra.locator('#anag-cf').fill(CF_LEAD);
		// Il lead aveva solo l'anno: per il socio la data intera è obbligatoria.
		await finestra.locator('#anag-nascita').fill('1994-03-02');
		await finestra.getByRole('button', { name: 'Avanti' }).click();
		await finestra.getByRole('button', { name: 'Salta' }).click();
		await finestra.getByRole('button', { name: 'Salta' }).click();
		await finestra.getByRole('checkbox', { name: 'Informativa privacy firmata' }).click();
		await finestra.getByRole('button', { name: 'Avanti' }).click();
		// L'ultimo "Salta" iscrive senza l'accesso al portale.
		await finestra.getByRole('button', { name: 'Salta' }).click();
		await pagStaff.waitForURL(/\/crm\/soci\//, { timeout: 10000 }).catch(() => {});
		[socioCreato] = await db.select().from(members).where(eq(members.codiceFiscale, CF_LEAD));
		const [trattativa] = await db.select().from(trattative).where(eq(trattative.id, idLead));
		const ok = socioCreato?.fullName === `Lucia ${COGNOME_LEAD}` && trattativa?.stato === 'iscritto'
			&& socioCreato?.personaId === idPersonaLead && pagStaff.url().includes(`/crm/soci/${socioCreato?.id}`);
		if (!ok) problemi.push({ percorso: 'iscrivere un contatto', errori: [`socio ${socioCreato?.fullName ?? 'assente'}, trattativa ${trattativa?.stato}, pagina ${pagStaff.url()}`], testo: '' });
		console.log(`  ${ok ? 'OK     ' : 'ROTTA  '} Iscrivi crea il socio sulla persona del contatto, chiude la trattativa e apre la scheda`);
	} else {
		problemi.push({ percorso: 'iscrivere un contatto', errori: ['pulsante non trovato'], testo: '' });
		console.log('  ROTTA   il contatto non si può iscrivere: pulsante non trovato');
	}

	const modifica = pagStaff.getByRole('button', { name: /Modifica anagrafica/ });
	await modifica.waitFor({ timeout: 10000 }).catch(() => {});
	if (socioCreato && await modifica.count()) {
		await modifica.click();
		await pagStaff.locator('#anag-cognome').fill(`${COGNOME_LEAD} Bis`);
		await pagStaff.getByRole('button', { name: /^Salva$/ }).click();
		await pagStaff.waitForTimeout(2000);
		const [dopo] = await db.select().from(members).where(eq(members.id, socioCreato.id));
		const ok = dopo?.fullName === `Lucia ${COGNOME_LEAD} Bis`;
		if (!ok) problemi.push({ percorso: "modificare l'anagrafica", errori: [`nome completo: ${dopo?.fullName}`], testo: '' });
		console.log(`  ${ok ? 'OK     ' : 'ROTTA  '} cambiando il cognome si ricalcola il nome completo`);
	} else {
		problemi.push({ percorso: "modificare l'anagrafica", errori: ['pulsante non trovato'], testo: '' });
		console.log("  ROTTA   l'anagrafica non si può modificare: pulsante non trovato");
	}

	console.log('\nPORTALE SOCI  (con dati seminati: si pretende di rivederli)');
	const pagSocio = await (await browser.newContext()).newPage();
	await entra(pagSocio, BASE, '/member-portal', emailSocio);
	for (const [percorso, atteso, prima] of PAGINE_SOCIO) await apri(pagSocio, percorso, atteso, BASE, prima);

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
	const creati = await db.select({ id: members.id }).from(members).where(eq(members.codiceFiscale, CF_LEAD));
	if (creati.length) {
		const ids = creati.map((c) => c.id);
		await db.delete(auditLogs).where(inArray(auditLogs.entitaId, ids));
		await db.delete(members).where(inArray(members.id, ids));
	}
	if (idPersonaLead) {
		await db.delete(consensi).where(eq(consensi.personaId, idPersonaLead));
		await db.delete(attivita).where(eq(attivita.personaId, idPersonaLead));
		await db.delete(trattative).where(eq(trattative.personaId, idPersonaLead));
		await db.delete(persone).where(eq(persone.id, idPersonaLead));
	}
	if (idCanale) await db.delete(canaliContatto).where(eq(canaliContatto.id, idCanale));
	if (idEnte && contatoreIniziale !== undefined) {
		const dove = and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio'));
		if (contatoreIniziale === null) await db.delete(numberingCounters).where(dove);
		else await db.update(numberingCounters).set({ value: contatoreIniziale }).where(dove);
	}
	await pool.end();
}

// I controlli sono le pagine più le quattro prove d'uso: contarli tutti, o un fallimento
// nell'interazione si nasconderebbe dietro un "23/23 pagine" rassicurante.
const totale = PAGINE_STAFF.length + PAGINE_SOCIO.length + 4;
console.log(`\n${totale - problemi.length}/${totale} controlli superati`);
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
