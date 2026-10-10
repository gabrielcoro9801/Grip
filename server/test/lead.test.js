// I contatti (lead) e la loro iscrizione, contro le rotte vere.
//
// Un lead è una trattativa di una persona. Le cose da non rompere: un contatto non entra nella
// piattaforma; i canali da cui arrivano si disattivano ma non spariscono; la persona e il suo
// diario restano quando si iscrive, e un ex socio che torna ritrova la sua scheda; la stessa
// persona non si registra due volte senza accorgersene.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { enteDellaNumerazione } from '../src/lib/codiceSocio.js';
import {
	members, staffAccounts, canaliContatto, numberingCounters, ruoli, persone, trattative, attivita, consensi,
} from '../src/db/schema/index.js';
import { caricaMatrice, caricaMatriceIniziale } from '../src/lib/ruoli.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { giro } from '../src/giro.js';

const PASSWORD = 'prova-lead-1234';
const CF = 'RSSMRA85T10A562S';

let app;
const token = {};
const idAccount = [];
const idSocio = [];
const idPersone = [];
const idCanali = [];
let canale;
let socioPortale;
let contatoreIniziale;
let idEnte;

const codiceDiProva = (prefisso) => `${prefisso}${String(Date.now() + Math.random()).replace(/\D/g, '').slice(-8).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`;
const come = (chi, opzioni) =>
	app.inject({ ...opzioni, headers: { authorization: `Bearer ${token[chi]}`, ...opzioni.headers } });
const post = (chi, url, payload = {}) => come(chi, { method: 'POST', url, payload });
const put = (chi, url, payload = {}) => come(chi, { method: 'PUT', url, payload });

async function nuovoLead(dati = {}) {
	const res = await post('reception', '/api/lead', {
		nome: 'Anna', cognome: 'Verdi', telefono: `347 ${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
		data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'F', ...dati,
	});
	assert.equal(res.statusCode, 201, res.body);
	idPersone.push(res.json().lead.persona_id);
	return res.json().lead;
}

/** Un socio inserito direttamente: la persona la crea il database. */
async function nuovoSocio(dati = {}) {
	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Prova', codiceSocio: codiceDiProva('LS'), ...dati }).returning();
	idSocio.push(socio.id);
	idPersone.push(socio.personaId);
	return socio;
}

/** Una trattativa nuova su una persona già nota. */
async function leadSuPersona(personaId) {
	const res = await post('reception', '/api/lead', { persona_id: personaId, data_contatto: oggiIso(), canale_id: canale.id });
	assert.equal(res.statusCode, 201, res.body);
	return res.json().lead;
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	socioPortale = await nuovoSocio({ nome: 'Socio', cognome: 'Lead', email: `soc.lead.${suffisso}@test.local` });

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception Lead', email: `rec.lead.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{ nome: 'Istruttore Lead', email: `ist.lead.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
			{ nome: 'Socio Lead', email: `soc.lead.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: socioPortale.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	const accedi = async (email) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
		assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
		return res.json().token;
	};
	token.reception = await accedi(account[0].email);
	token.istruttore = await accedi(account[1].email);
	token.socio = await accedi(account[2].email);

	const [c] = await db.insert(canaliContatto).values({ nome: `Canale prova ${suffisso}` }).returning();
	canale = c;
	idCanali.push(c.id);

	// L'iscrizione consuma un codice socio: a fine prova il contatore torna dov'era.
	idEnte = await enteDellaNumerazione(db);
	if (idEnte) {
		const [riga] = await db.select().from(numberingCounters)
			.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
		contatoreIniziale = riga?.value ?? null;
	}
});

after(async () => {
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio.length) await db.delete(members).where(inArray(members.id, idSocio));
	// Le persone portano via trattative, diario e consensi; poi i canali non sono più citati.
	if (idPersone.length) await db.delete(persone).where(inArray(persone.id, idPersone));
	if (idCanali.length) await db.delete(canaliContatto).where(inArray(canaliContatto.id, idCanali));
	if (idEnte) {
		const dove = and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio'));
		if (contatoreIniziale === null) await db.delete(numberingCounters).where(dove);
		else await db.update(numberingCounters).set({ value: contatoreIniziale }).where(dove);
	}
	await app.close();
	await pool.end();
});

describe('i lead restano fuori', () => {
	test('il socio non legge né scrive contatti e canali, e non iscrive', async () => {
		const lead = await nuovoLead();
		for (const url of ['/api/lead/lavoro', '/api/entities/CanaleContatto', `/api/lead/${lead.id}/attivita`, '/api/lead/doppioni?telefono=3471234567']) {
			assert.equal((await come('socio', { method: 'GET', url })).statusCode, 403, url);
		}
		assert.equal((await post('socio', '/api/lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await post('socio', `/api/lead/${lead.id}/trasforma`, { nome: 'X' })).statusCode, 403);
		assert.equal((await come('socio', { method: 'GET', url: `/api/persone/${lead.persona_id}/diario` })).statusCode, 403);
	});

	test("l'istruttore li vede ma non li tocca", async () => {
		const lead = await nuovoLead();
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/lavoro' })).statusCode, 200);
		assert.equal((await post('istruttore', '/api/lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await put('istruttore', `/api/lead/${lead.id}`, { nome: 'X' })).statusCode, 403);
		assert.equal((await come('istruttore', { method: 'DELETE', url: `/api/lead/${lead.id}` })).statusCode, 403);
		assert.equal((await post('istruttore', '/api/entities/CanaleContatto', { nome: 'X' })).statusCode, 403);
	});

	test("i contatti non passano più dall'endpoint generico", async () => {
		assert.notEqual((await come('reception', { method: 'GET', url: '/api/entities/Lead' })).statusCode, 200);
		assert.notEqual((await post('reception', '/api/entities/Lead', { nome: 'X' })).statusCode, 201);
	});
});

describe('registrare un contatto', () => {
	test('bastano nome, un recapito, canale e giorno: cognome, sesso e anno sono facoltativi', async () => {
		const minimo = { nome: 'Solo', telefono: '333 1234567', data_contatto: '2026-09-10', canale_id: canale.id };
		for (const manca of ['nome', 'telefono', 'data_contatto', 'canale_id']) {
			const { [manca]: _tolto, ...corpo } = minimo;
			const res = await post('reception', '/api/lead', corpo);
			assert.equal(res.statusCode, 400, `senza ${manca}: ${res.body}`);
		}
		assert.equal((await post('reception', '/api/lead', { ...minimo, nome: '  ' })).statusCode, 400, 'nome di soli spazi');
		assert.equal((await post('reception', '/api/lead', { ...minimo, sesso: 'X' })).statusCode, 400);
		assert.equal((await post('reception', '/api/lead', { ...minimo, anno_nascita: 1800 })).statusCode, 400);
		assert.equal((await post('reception', '/api/lead', { ...minimo, telefono: '333 000' })).statusCode, 400, 'un telefono che non è un numero');

		const lead = await nuovoLead({ ...minimo, cognome: '', sesso: '', email: '' });
		assert.equal(lead.cognome, null);
		assert.equal(lead.sesso, null);
		assert.equal(lead.email, null, 'un campo lasciato vuoto non è un recapito');
		assert.equal(lead.telefono, '+393331234567', 'il telefono si salva in formato internazionale');
		assert.equal(lead.stato, 'nuovo');

		const soloEmail = await nuovoLead({ telefono: '', email: 'solo@test.local' });
		assert.equal(soloEmail.telefono, null);
	});

	test('la nota sta in 140 caratteri, e una di soli spazi è nessuna nota', async () => {
		const lunga = await post('reception', '/api/lead', { nome: 'A', email: 'a@test.local', data_contatto: '2026-09-10', canale_id: canale.id, note: 'x'.repeat(141) });
		assert.equal(lunga.statusCode, 400);
		assert.match(lunga.json().error, /140 caratteri/);

		const giusta = await nuovoLead({ note: `  ${'x'.repeat(140)}  ` });
		assert.equal(giusta.note, 'x'.repeat(140), 'gli spazi attorno non contano');

		const vuota = await put('reception', `/api/lead/${giusta.id}`, { note: '   ' });
		assert.equal(vuota.statusCode, 200, vuota.body);
		assert.equal(vuota.json().lead.note, null);
	});

	test('la correzione cambia i dati, non lo stato', async () => {
		const lead = await nuovoLead();
		const res = await put('reception', `/api/lead/${lead.id}`, { cognome: 'Corretto', stato: 'non_interessato', tentativi_senza_risposta: 9 });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().lead.cognome, 'Corretto');
		assert.equal(res.json().lead.stato, 'nuovo');
		assert.equal(res.json().lead.tentativi_senza_risposta, 0);
	});
});

describe('la stessa persona', () => {
	test('un numero già noto si riconosce, comunque sia scritto', async () => {
		const lead = await nuovoLead({ telefono: '+39 348 7654321' });
		const res = await come('reception', { method: 'GET', url: '/api/lead/doppioni?telefono=0039%20348.765.4321' });
		assert.equal(res.statusCode, 200, res.body);
		const trovato = res.json().doppioni.find((d) => d.persona_id === lead.persona_id);
		assert.equal(trovato?.tipo, 'contatto_aperto');
		assert.equal(trovato.trattativa_aperta_id, lead.id);
		assert.deepEqual(Object.keys(trovato).sort(), ['nome', 'persona_id', 'tipo', 'trattativa_aperta_id'], 'solo il nome e che cosa è');

		const escluso = await come('reception', { method: 'GET', url: `/api/lead/doppioni?telefono=3487654321&escludi=${lead.persona_id}` });
		assert.ok(!escluso.json().doppioni.some((d) => d.persona_id === lead.persona_id));
	});

	test('un socio si riconosce dalla email, e un archiviato è un ex socio', async () => {
		const email = `Doppio.${Date.now()}@Test.local`;
		const socio = await nuovoSocio({ email });
		let res = await come('reception', { method: 'GET', url: `/api/lead/doppioni?email=${encodeURIComponent(email.toLowerCase())}` });
		assert.equal(res.json().doppioni.find((d) => d.persona_id === socio.personaId)?.tipo, 'socio');
		await db.update(members).set({ archiviatoIl: '2026-01-31' }).where(eq(members.id, socio.id));
		res = await come('reception', { method: 'GET', url: `/api/lead/doppioni?email=${encodeURIComponent(email)}` });
		assert.equal(res.json().doppioni.find((d) => d.persona_id === socio.personaId)?.tipo, 'ex_socio');
	});

	test('una persona già nota riceve una trattativa nuova, ma una sola aperta', async () => {
		const socio = await nuovoSocio({ nome: 'Ex', cognome: 'Socio', phone: '+393401234567' });
		const lead = await leadSuPersona(socio.personaId);
		assert.equal(lead.persona_id, socio.personaId);
		assert.equal(lead.nome, 'Ex', 'i dati sono quelli del socio');
		assert.equal(lead.socio_id, socio.id);

		const seconda = await post('reception', '/api/lead', { persona_id: socio.personaId, data_contatto: oggiIso(), canale_id: canale.id });
		assert.equal(seconda.statusCode, 400);
		assert.match(seconda.json().error, /già un contatto aperto/);

		const modifica = await put('reception', `/api/lead/${lead.id}`, { telefono: '3330000000' });
		assert.equal(modifica.statusCode, 400, 'i dati di un socio si cambiano dalla sua scheda');
		assert.match(modifica.json().error, /scheda da socio/);
		assert.equal((await put('reception', `/api/lead/${lead.id}`, { data_contatto: '2026-09-01' })).statusCode, 200, 'la trattativa sì');
	});
});

describe('eliminare un contatto', () => {
	test('sparisce con la sua persona se non le resta altro; la persona di un socio resta', async () => {
		const lead = await nuovoLead();
		assert.equal((await come('reception', { method: 'DELETE', url: `/api/lead/${lead.id}` })).statusCode, 204);
		assert.equal((await db.select().from(persone).where(eq(persone.id, lead.persona_id))).length, 0);

		const socio = await nuovoSocio();
		const suSocio = await leadSuPersona(socio.personaId);
		assert.equal((await come('reception', { method: 'DELETE', url: `/api/lead/${suSocio.id}` })).statusCode, 204);
		assert.equal((await db.select().from(persone).where(eq(persone.id, socio.personaId))).length, 1);
	});
});

describe('i canali', () => {
	test('un canale usato non si elimina, si disattiva', async () => {
		const [usato] = await db.insert(canaliContatto).values({ nome: `Usato ${Date.now()}` }).returning();
		idCanali.push(usato.id);
		await nuovoLead({ canale_id: usato.id });

		const elimina = await come('reception', { method: 'DELETE', url: `/api/entities/CanaleContatto/${usato.id}` });
		assert.equal(elimina.statusCode, 400);
		assert.match(elimina.json().error, /disattivalo/);

		const disattiva = await come('reception', { method: 'PUT', url: `/api/entities/CanaleContatto/${usato.id}`, payload: { attivo: false } });
		assert.equal(disattiva.json().attivo, false);
	});

	test("l'uso di ogni canale conta i contatti e i soci arrivati da lì", async () => {
		const [nuovo] = await db.insert(canaliContatto).values({ nome: `Uso ${Date.now()}` }).returning();
		idCanali.push(nuovo.id);
		await nuovoLead({ canale_id: nuovo.id });
		await nuovoLead({ canale_id: nuovo.id });
		const iscritto = await nuovoLead({ canale_id: nuovo.id });
		await db.update(trattative).set({ stato: 'iscritto' }).where(eq(trattative.id, iscritto.id));

		const uso = await come('reception', { method: 'GET', url: '/api/lead/canali/uso' });
		assert.equal(uso.statusCode, 200, uso.body);
		assert.deepEqual(uso.json()[nuovo.id], { contatti: 2, soci: 1 });

		// Chi vede i lead in sola lettura vede anche i conti; il socio no.
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/canali/uso' })).statusCode, 200);
		assert.equal((await come('socio', { method: 'GET', url: '/api/lead/canali/uso' })).statusCode, 403);
	});

	test('due canali con lo stesso nome no', async () => {
		const res = await post('reception', '/api/entities/CanaleContatto', { nome: canale.nome });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /canale con questo nome/);
	});
});

describe("l'iscrizione", () => {
	const iscrivi = (id, corpo) => post('reception', `/api/lead/${id}/trasforma`, corpo);
	const anagraficaCompleta = { nome: 'Anna Maria', cognome: 'Verdi', sesso: 'F', codice_fiscale: CF.toLowerCase(), date_of_birth: '1985-12-10' };

	test('senza codice fiscale valido o senza data di nascita non si fa, e il contatto resta', async () => {
		const lead = await nuovoLead();
		const base = { nome: 'Anna', cognome: 'Verdi', sesso: 'F', date_of_birth: '1994-03-02' };
		assert.equal((await iscrivi(lead.id, base)).statusCode, 400);
		assert.equal((await iscrivi(lead.id, { ...base, codice_fiscale: 'RSSMRA85T10A562T' })).statusCode, 400);
		const senzaData = await iscrivi(lead.id, { nome: 'Anna', cognome: 'Verdi', sesso: 'F', codice_fiscale: CF });
		assert.equal(senzaData.statusCode, 400);
		assert.match(senzaData.json().error, /data di nascita/);
		const [ancora] = await db.select().from(trattative).where(eq(trattative.id, lead.id));
		assert.equal(ancora.stato, 'nuovo');
	});

	test('nasce il socio sulla persona; la trattativa diventa iscritta e il diario resta', async () => {
		const lead = await nuovoLead({ telefono: '333 111 2222', email: 'anna@test.local', note: 'Chiede del corso bimbi' });
		await post('reception', `/api/lead/${lead.id}/contatto`, { canale: 'telefono', esito: 'risposto', nota: 'Passa giovedì' });

		const corpo = {
			...anagraficaCompleta, phone: '333 111 2222', email: 'anna@test.local', gdpr_consent: true,
			full_name: 'Nome Inventato', codice_socio: '999999', notes: lead.note,
		};
		const lunga = await iscrivi(lead.id, { ...corpo, notes: 'x'.repeat(141) });
		assert.equal(lunga.statusCode, 400, 'anche il socio ha note da 140 caratteri');
		const ok = await iscrivi(lead.id, corpo);
		assert.equal(ok.statusCode, 201, ok.body);
		const { member, riattivato } = ok.json();
		idSocio.push(member.id);

		assert.equal(riattivato, false);
		assert.equal(member.full_name, 'Anna Maria Verdi', 'il nome completo lo calcola il database');
		assert.equal(member.codice_fiscale, CF, 'normalizzato in maiuscolo');
		assert.equal(member.phone, '+393331112222');
		assert.equal(member.notes, 'Chiede del corso bimbi');
		assert.equal(member.gdpr_consent, true);
		assert.ok(member.gdpr_consent_date);
		if (idEnte) assert.match(member.codice_socio, /^\d{6}$/);
		assert.notEqual(member.codice_socio, '999999', 'il codice lo assegna il contatore');
		assert.equal(member.persona_id, lead.persona_id, 'è la stessa persona');

		const [trattativa] = await db.select().from(trattative).where(eq(trattative.id, lead.id));
		assert.equal(trattativa.stato, 'iscritto');
		assert.equal(trattativa.canaleId, canale.id, 'Andamento sa da dove è arrivato');
		const [persona] = await db.select().from(persone).where(eq(persone.id, lead.persona_id));
		assert.equal(persona.fullName, 'Anna Maria Verdi', 'la persona ora segue il socio');

		const diario = await db.select().from(attivita).where(eq(attivita.personaId, lead.persona_id)).orderBy(attivita.createdDate);
		assert.deepEqual(diario.map((a) => a.tipo), ['risposta', 'iscrizione']);
		assert.equal(diario[0].nota, 'Passa giovedì');

		// Non sta più fra i contatti da lavorare, e non si iscrive due volte.
		const lavoro = await come('reception', { method: 'GET', url: '/api/lead/lavoro' });
		assert.ok(!lavoro.json().leads.some((l) => l.id === lead.id));
		assert.equal((await iscrivi(lead.id, anagraficaCompleta)).statusCode, 404);
		assert.equal((await post('reception', `/api/lead/${lead.id}/riapri`)).statusCode, 400, 'una trattativa vinta non si riapre');
	});

	test('un ex socio che torna ritrova la sua scheda, con il suo codice e la sua storia', async () => {
		const socio = await nuovoSocio({ nome: 'Tornato', cognome: 'Prova', archiviatoIl: '2025-12-31', codiceFiscale: 'BNCLRA90A41H501F' });
		const lead = await leadSuPersona(socio.personaId);
		const res = await iscrivi(lead.id, { ...anagraficaCompleta, nome: 'Tornato', cognome: 'Prova', codice_fiscale: 'BNCLRA90A41H501F', date_of_birth: '1990-01-01' });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().riattivato, true);
		assert.equal(res.json().member.id, socio.id, 'la stessa scheda, non una nuova');
		assert.equal(res.json().member.codice_socio, socio.codiceSocio);
		assert.equal(res.json().member.archiviato_il, null);
		const [ultima] = await db.select().from(attivita).where(and(eq(attivita.personaId, socio.personaId), eq(attivita.tipo, 'iscrizione')));
		assert.equal(ultima.esito, 'riattivato');
	});

	test('chi gestisce i contatti ma non i soci non iscrive', async () => {
		// Si toglie alla reception la modifica dei soci, e si rimette com'era.
		const [ruolo] = await db.select().from(ruoli).where(eq(ruoli.nome, 'reception')).limit(1);
		if (!ruolo) return; // installazione senza ruoli salvati: la matrice è quella predefinita
		const originali = ruolo.permessi;
		try {
			await db.update(ruoli).set({ permessi: { ...originali, crm_members: ['view'], crm_leads: ['view', 'edit'] } }).where(eq(ruoli.id, ruolo.id));
			await caricaMatrice(ruolo.organizationId);
			const lead = await nuovoLead();
			assert.equal((await iscrivi(lead.id, anagraficaCompleta)).statusCode, 403);
		} finally {
			await db.update(ruoli).set({ permessi: originali }).where(eq(ruoli.id, ruolo.id));
			await caricaMatriceIniziale();
		}
	});
});

describe('i dati di Andamento', () => {
	test('righe anonime: aperti, persi col motivo, iscritti col giorno', async () => {
		const [canaleAndamento] = await db.insert(canaliContatto).values({ nome: `Andamento ${Date.now()}` }).returning();
		idCanali.push(canaleAndamento.id);
		await nuovoLead({ canale_id: canaleAndamento.id, anno_nascita: 1990 });
		const perso = await nuovoLead({ canale_id: canaleAndamento.id, sesso: '' });
		await db.update(trattative).set({ stato: 'non_interessato', motivoChiusura: 'orari' }).where(eq(trattative.id, perso.id));
		const iscritto = await nuovoLead({ canale_id: canaleAndamento.id, anno_nascita: 1992, sesso: 'M' });
		await db.update(trattative).set({ stato: 'iscritto', statoDal: '2026-09-20' }).where(eq(trattative.id, iscritto.id));

		const res = await come('reception', { method: 'GET', url: '/api/lead/andamento' });
		assert.equal(res.statusCode, 200, res.body);
		const righe = res.json().righe.filter((r) => r.canale_id === canaleAndamento.id);
		assert.deepEqual(righe.map((r) => r.esito).sort(), ['aperto', 'perso', 'socio']);
		assert.equal(righe.find((r) => r.esito === 'perso').motivo, 'orari');
		assert.equal(righe.find((r) => r.esito === 'perso').sesso, null, 'il sesso non indicato resta vuoto');
		const delSocio = righe.find((r) => r.esito === 'socio');
		assert.equal(delSocio.anno_nascita, 1992);
		assert.equal(delSocio.socio_dal, '2026-09-20');
		// Niente nomi, niente recapiti: escono solo i campi dei conti.
		assert.deepEqual(Object.keys(righe[0]).sort(), ['anno_nascita', 'canale_id', 'data_contatto', 'esito', 'motivo', 'sesso', 'socio_dal']);
		assert.ok(res.json().canali.some((c) => c.id === canaleAndamento.id));

		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/andamento' })).statusCode, 200);
		assert.equal((await come('socio', { method: 'GET', url: '/api/lead/andamento' })).statusCode, 403);
	});
});

describe('gli stati di un lead', () => {
	const azione = (chi, id, nome, corpo = {}) => post(chi, `/api/lead/${id}/${nome}`, corpo);
	const diario = async (personaId) => db.select().from(attivita).where(eq(attivita.personaId, personaId)).orderBy(attivita.createdDate);

	test('ogni azione cambia lo stato e lascia una riga nel diario della persona, firmata', async () => {
		const lead = await nuovoLead();
		let r = await azione('reception', lead.id, 'contatto', { canale: 'telefono', esito: 'nessuna_risposta' });
		assert.equal(r.statusCode, 200, r.body);
		assert.equal(r.json().lead.stato, 'in_attesa');
		assert.equal(r.json().lead.tentativi_senza_risposta, 1);

		r = await azione('reception', lead.id, 'contatto', { canale: 'whatsapp', esito: 'risposto', nota: 'Chiede gli orari' });
		assert.equal(r.json().lead.stato, 'in_conversazione');
		assert.equal(r.json().lead.tentativi_senza_risposta, 0);

		r = await azione('reception', lead.id, 'richiamo', { data: spostaGiorni(oggiIso(), 5) });
		assert.equal(r.json().lead.stato, 'da_richiamare');

		assert.equal((await azione('reception', lead.id, 'chiudi', { motivo: 'altro' })).statusCode, 400, 'altro senza nota');
		r = await azione('reception', lead.id, 'chiudi', { motivo: 'prezzo' });
		assert.equal(r.json().lead.stato, 'non_interessato');
		assert.equal(r.json().lead.motivo_chiusura, 'prezzo');

		assert.equal((await azione('reception', lead.id, 'contatto', { canale: 'telefono', esito: 'risposto' })).statusCode, 400, 'chiuso non si lavora');
		r = await azione('reception', lead.id, 'riapri');
		assert.equal(r.json().lead.stato, 'in_attesa');

		const righe = await diario(lead.persona_id);
		assert.deepEqual(righe.map((a) => a.tipo), ['tentativo', 'risposta', 'richiamo', 'chiusura', 'riapertura']);
		assert.equal(righe[1].nota, 'Chiede gli orari');
		assert.ok(righe.every((a) => a.autoreNome === 'Reception Lead' && a.trattativaId === lead.id));

		const letto = await come('reception', { method: 'GET', url: `/api/lead/${lead.id}/attivita` });
		assert.equal(letto.json().attivita.length, 5);
	});

	test('troppi tentativi senza risposta, e da tanto: il giro lo chiude da solo, una volta sola; la GET non scrive', async () => {
		const lead = await nuovoLead();
		await db.update(trattative).set({
			stato: 'in_attesa', tentativiSenzaRisposta: 3, ultimoContattoIl: spostaGiorni(oggiIso(), -20),
		}).where(eq(trattative.id, lead.id));

		const letto = await come('reception', { method: 'GET', url: '/api/lead/lavoro' });
		assert.equal(letto.statusCode, 200, letto.body);
		assert.equal(letto.json().leads.find((l) => l.id === lead.id).stato, 'in_attesa', 'una GET non scrive');
		assert.equal(letto.json().soglie.tentativiMassimi, 3, 'la pagina riceve le soglie con cui filtrare');

		const [esito] = await giro();
		assert.ok(esito.non_raggiungibili >= 1);
		const dopo = await come('reception', { method: 'GET', url: '/api/lead/lavoro' });
		assert.equal(dopo.json().leads.find((l) => l.id === lead.id).stato, 'non_raggiungibile');
		assert.ok(dopo.json().conteggi.chiusi >= 1);

		await giro();
		const automatici = (await diario(lead.persona_id)).filter((a) => a.tipo === 'stato_automatico');
		assert.equal(automatici.length, 1);
		assert.equal(automatici[0].autoreNome, 'Sistema');
		assert.equal(automatici[0].autoreId, null);
	});

	test('chi vede i lead legge il lavoro, ma per agire serve poterli modificare', async () => {
		const lead = await nuovoLead();
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/lavoro' })).statusCode, 200);
		assert.equal((await azione('istruttore', lead.id, 'contatto', { canale: 'telefono', esito: 'risposto' })).statusCode, 403);
		assert.equal((await come('socio', { method: 'GET', url: '/api/lead/lavoro' })).statusCode, 403);
		assert.equal((await azione('reception', lead.id, 'vola', {})).statusCode, 404);
	});
});

describe('il diario e i consensi di una persona', () => {
	test('la segreteria scrive note nel diario e registra i consensi del modulo firmato', async () => {
		const socio = await nuovoSocio();
		const url = `/api/persone/${socio.personaId}`;
		assert.equal((await post('reception', `${url}/note`, { nota: '  ' })).statusCode, 400);
		assert.equal((await post('reception', `${url}/note`, { nota: 'x'.repeat(501) })).statusCode, 400);
		assert.equal((await post('reception', `${url}/note`, { nota: 'Si è trasferito in centro' })).statusCode, 201);
		assert.equal((await post('istruttore', `${url}/note`, { nota: 'No' })).statusCode, 403);

		assert.equal((await post('reception', `${url}/consensi`, { tipo: 'marketing_fax', valore: true })).statusCode, 400);
		const dato = await post('reception', `${url}/consensi`, { tipo: 'marketing_sms', valore: true });
		assert.equal(dato.statusCode, 200, dato.body);
		assert.equal(dato.json().consensi.marketing_sms.valore, true);
		assert.equal(dato.json().consensi.marketing_sms.fonte, 'reception');
		assert.equal(dato.json().consensi.marketing_email.valore, false, 'senza una scelta, il consenso non c\'è');

		const letto = await come('reception', { method: 'GET', url: `${url}/diario` });
		assert.equal(letto.statusCode, 200, letto.body);
		assert.equal(letto.json().attivita.at(-1).nota, 'Si è trasferito in centro');
		assert.equal(letto.json().consensi.marketing_sms.valore, true);
		assert.equal((await come('reception', { method: 'GET', url: '/api/persone/00000000-0000-0000-0000-000000000000/diario' })).statusCode, 404);
	});

	test('il socio dà e toglie i suoi consensi dal portale, e restano nel registro', async () => {
		const portale = (opzioni) => come('socio', { ...opzioni, url: '/api/member/v1/consensi' });
		assert.equal((await portale({ method: 'GET' })).json().consensi.marketing_email.valore, false);
		assert.equal((await portale({ method: 'PUT', payload: { tipo: 'marketing_email', valore: 'si' } })).statusCode, 400);
		let res = await portale({ method: 'PUT', payload: { tipo: 'marketing_email', valore: true } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().consensi.marketing_email.fonte, 'portale');
		res = await portale({ method: 'PUT', payload: { tipo: 'marketing_email', valore: false } });
		assert.equal(res.json().consensi.marketing_email.valore, false);
		const registro = await db.select().from(consensi).where(eq(consensi.personaId, socioPortale.personaId));
		assert.equal(registro.length, 2, 'ogni scelta è una riga');
		assert.ok(registro.every((r) => r.autoreNome === 'Socio Lead'));
	});
});
