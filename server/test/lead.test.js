// I lead e la loro trasformazione in soci, contro le rotte vere.
//
// Tre cose da non rompere: un lead è un contatto e non entra nella piattaforma; i canali da
// cui arrivano si disattivano ma non spariscono da sotto i contatti; e la trasformazione crea
// il socio e cancella il contatto insieme, o non fa niente.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { enteDellaNumerazione } from '../src/lib/codiceSocio.js';
import { members, staffAccounts, leads, canaliContatto, numberingCounters, ruoli, leadAttivita } from '../src/db/schema/index.js';
import { caricaMatrice, caricaMatriceIniziale } from '../src/lib/ruoli.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-lead-1234';
const CF = 'RSSMRA85T10A562S';

let app;
const token = {};
const idAccount = [];
const idSocio = [];
const idLead = [];
const idCanali = [];
let canale;
let contatoreIniziale;
let idEnte;

const come = (chi, opzioni) =>
	app.inject({ ...opzioni, headers: { authorization: `Bearer ${token[chi]}`, ...opzioni.headers } });
const post = (chi, url, payload = {}) => come(chi, { method: 'POST', url, payload });

async function nuovoLead(dati = {}) {
	const res = await post('reception', '/api/entities/Lead', {
		nome: 'Anna', cognome: 'Verdi', data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'F', ...dati,
	});
	assert.equal(res.statusCode, 201, res.body);
	idLead.push(res.json().id);
	return res.json();
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Lead', codiceSocio: `LE${String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, email: `soc.lead.${suffisso}@test.local` }).returning();
	idSocio.push(socio.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception Lead', email: `rec.lead.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{ nome: 'Istruttore Lead', email: `ist.lead.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
			{ nome: 'Socio Lead', email: `soc.lead.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
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

	// La trasformazione consuma un codice socio: a fine prova il contatore torna dov'era.
	// Lo stesso ente che userà il server per numerare.
	idEnte = await enteDellaNumerazione(db);
	if (idEnte) {
		const [riga] = await db.select().from(numberingCounters)
			.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
		contatoreIniziale = riga?.value ?? null;
	}
});

after(async () => {
	// I soci nati da un contatto citano il canale: vanno via prima dei canali.
	if (idLead.length) await db.delete(leads).where(inArray(leads.id, idLead));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(inArray(members.id, idSocio));
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
	test('il socio non legge né scrive lead e canali, e non trasforma', async () => {
		const lead = await nuovoLead();
		for (const url of ['/api/entities/Lead', '/api/entities/CanaleContatto', `/api/entities/Lead/${lead.id}`]) {
			assert.equal((await come('socio', { method: 'GET', url })).statusCode, 403, url);
		}
		assert.equal((await post('socio', '/api/entities/Lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await post('socio', `/api/lead/${lead.id}/trasforma`, { nome: 'X' })).statusCode, 403);
	});

	test("l'istruttore li vede ma non li tocca", async () => {
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/entities/Lead' })).statusCode, 200);
		assert.equal((await post('istruttore', '/api/entities/Lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await post('istruttore', '/api/entities/CanaleContatto', { nome: 'X' })).statusCode, 403);
	});
});

describe("l'anagrafica di un lead", () => {
	test('nome, cognome, giornata, canale e sesso sono obbligatori; telefono, email e anno no', async () => {
		const completo = { nome: 'A', cognome: 'B', data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'M' };
		for (const manca of Object.keys(completo)) {
			const { [manca]: _tolto, ...corpo } = completo;
			const res = await post('reception', '/api/entities/Lead', corpo);
			assert.equal(res.statusCode, 400, `senza ${manca}: ${res.body}`);
		}
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, nome: '  ' })).statusCode, 400, 'nome di soli spazi');
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, sesso: 'X' })).statusCode, 400);
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, anno_nascita: 1800 })).statusCode, 400);

		const lead = await nuovoLead({ telefono: '', email: '' });
		assert.equal(lead.telefono, null, 'un campo lasciato vuoto non è un numero');
		assert.equal(lead.email, null);
		assert.equal(lead.note, null);
	});

	test('la nota sta in 140 caratteri, e una di soli spazi è nessuna nota', async () => {
		const completo = { nome: 'A', cognome: 'B', data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'M' };
		const lunga = await post('reception', '/api/entities/Lead', { ...completo, note: 'x'.repeat(141) });
		assert.equal(lunga.statusCode, 400);
		assert.match(lunga.json().error, /140 caratteri/);

		const giusta = await nuovoLead({ note: `  ${'x'.repeat(140)}  ` });
		assert.equal(giusta.note, 'x'.repeat(140), 'gli spazi attorno non contano');

		const vuota = await come('reception', { method: 'PUT', url: `/api/entities/Lead/${giusta.id}`, payload: { note: '   ' } });
		assert.equal(vuota.statusCode, 200, vuota.body);
		assert.equal(vuota.json().note, null);
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
		const [socio] = await db.insert(members).values({
			// Codici di prova senza cifre: il contatore dei codici veri prende il massimo delle cifre.
			nome: 'Da', cognome: 'Canale', codiceSocio: `UC${String(Date.now()).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, leadCanaleId: nuovo.id, leadDataContatto: '2026-09-01',
		}).returning();
		idSocio.push(socio.id);

		const uso = await come('reception', { method: 'GET', url: '/api/lead/canali/uso' });
		assert.equal(uso.statusCode, 200, uso.body);
		assert.deepEqual(uso.json()[nuovo.id], { contatti: 2, soci: 1 });

		// Chi vede i lead in sola lettura vede anche i conti; il socio no.
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/canali/uso' })).statusCode, 200);
		assert.equal((await come('socio', { method: 'GET', url: '/api/lead/canali/uso' })).statusCode, 403);
	});

	test('un canale da cui è arrivato un socio non si elimina', async () => {
		const [canaleSocio] = await db.insert(canaliContatto).values({ nome: `Di un socio ${Date.now()}` }).returning();
		idCanali.push(canaleSocio.id);
		const [socio] = await db.insert(members).values({
			nome: 'Gia', cognome: 'Socio', codiceSocio: `CS${String(Date.now()).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, leadCanaleId: canaleSocio.id,
		}).returning();
		idSocio.push(socio.id);

		const elimina = await come('reception', { method: 'DELETE', url: `/api/entities/CanaleContatto/${canaleSocio.id}` });
		assert.equal(elimina.statusCode, 400);
		assert.match(elimina.json().error, /arrivati dei soci.*disattivalo/);
	});

	test('due canali con lo stesso nome no', async () => {
		const res = await post('reception', '/api/entities/CanaleContatto', { nome: canale.nome });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /canale con questo nome/);
	});
});

describe('la trasformazione in socio', () => {
	test('senza codice fiscale valido o senza data di nascita non si fa, e il lead resta', async () => {
		// Il lead l'anno di nascita può non averlo: la data diventa obbligatoria qui, quando nasce il socio.
		const lead = await nuovoLead();
		const base = { nome: 'Anna', cognome: 'Verdi', sesso: 'F', date_of_birth: '1994-03-02' };
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, base)).statusCode, 400);
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, { ...base, codice_fiscale: 'RSSMRA85T10A562T' })).statusCode, 400);
		const senzaData = await post('reception', `/api/lead/${lead.id}/trasforma`, { nome: 'Anna', cognome: 'Verdi', sesso: 'F', codice_fiscale: CF });
		assert.equal(senzaData.statusCode, 400);
		assert.match(senzaData.json().error, /data di nascita/);
		const [ancora] = await db.select().from(leads).where(eq(leads.id, lead.id));
		assert.ok(ancora);
	});

	test('crea il socio col codice e cancella il lead; la seconda volta non trova niente', async () => {
		const lead = await nuovoLead({ telefono: '333 111', email: 'anna@test.local', note: 'Chiede del corso bimbi' });
		// La finestra precompila le note del socio con quella del lead: arriva nel corpo.
		const corpo = {
			nome: 'Anna Maria', cognome: 'Verdi', sesso: 'F', codice_fiscale: CF.toLowerCase(), date_of_birth: '1985-12-10', phone: '333 111',
			email: 'anna@test.local', gdpr_consent: true, full_name: 'Nome Inventato', codice_socio: '999999',
			notes: lead.note,
		};
		const lunga = await post('reception', `/api/lead/${lead.id}/trasforma`, { ...corpo, notes: 'x'.repeat(141) });
		assert.equal(lunga.statusCode, 400, 'anche il socio ha note da 140 caratteri');
		const ok = await post('reception', `/api/lead/${lead.id}/trasforma`, corpo);
		assert.equal(ok.statusCode, 201, ok.body);
		assert.equal(ok.json().member.notes, 'Chiede del corso bimbi');
		const { member } = ok.json();
		idSocio.push(member.id);

		assert.equal(member.full_name, 'Anna Maria Verdi', 'il nome completo lo calcola il database');
		assert.equal(member.codice_fiscale, CF, 'normalizzato in maiuscolo');
		assert.equal(member.gdpr_consent, true);
		assert.ok(member.gdpr_consent_date);
		if (idEnte) assert.match(member.codice_socio, /^\d{6}$/);
		assert.notEqual(member.codice_socio, '999999', 'il codice lo assegna il contatore');

		assert.equal((await db.select().from(leads).where(eq(leads.id, lead.id))).length, 0, 'il lead non c\'è più');

		// Il lead è sparito, ma il socio ricorda da dove veniva: è ciò che Andamento conta.
		const [riga] = await db.select().from(members).where(eq(members.id, member.id));
		assert.equal(riga.leadCanaleId, canale.id);
		assert.equal(riga.leadDataContatto, '2026-09-10');

		// E dall'endpoint generico la provenienza non si riscrive.
		await come('reception', {
			method: 'PUT', url: `/api/entities/Member/${member.id}`,
			payload: { lead_canale_id: null, lead_data_contatto: '2020-01-01' },
		});
		const [dopo] = await db.select().from(members).where(eq(members.id, member.id));
		assert.equal(dopo.leadCanaleId, canale.id);
		assert.equal(dopo.leadDataContatto, '2026-09-10');
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, { nome: 'A', cognome: 'B', sesso: 'F', codice_fiscale: CF, date_of_birth: '1985-12-10' })).statusCode, 404);
	});

	test('chi gestisce i lead ma non i soci non trasforma', async () => {
		// Si toglie alla reception la modifica dei soci, e si rimette com'era.
		const [ruolo] = await db.select().from(ruoli).where(eq(ruoli.nome, 'reception')).limit(1);
		if (!ruolo) return; // installazione senza ruoli salvati: la matrice è quella predefinita
		const originali = ruolo.permessi;
		try {
			await db.update(ruoli).set({ permessi: { ...originali, crm_members: ['view'], crm_leads: ['view', 'edit'] } }).where(eq(ruoli.id, ruolo.id));
			await caricaMatrice(ruolo.organizationId);
			const lead = await nuovoLead();
			const res = await post('reception', `/api/lead/${lead.id}/trasforma`, { nome: 'A', cognome: 'B', sesso: 'F', codice_fiscale: CF, date_of_birth: '1985-12-10' });
			assert.equal(res.statusCode, 403);
		} finally {
			await db.update(ruoli).set({ permessi: originali }).where(eq(ruoli.id, ruolo.id));
			await caricaMatriceIniziale();
		}
	});
});

describe('i dati di Andamento', () => {
	test('righe anonime: lead aperti, lead persi col motivo, soci nati da un contatto', async () => {
		const [canaleAndamento] = await db.insert(canaliContatto).values({ nome: `Andamento ${Date.now()}` }).returning();
		idCanali.push(canaleAndamento.id);
		const aperto = await nuovoLead({ canale_id: canaleAndamento.id, anno_nascita: 1990 });
		const perso = await nuovoLead({ canale_id: canaleAndamento.id });
		await db.update(leads).set({ stato: 'non_interessato', motivoChiusura: 'orari' }).where(eq(leads.id, perso.id));
		const [socio] = await db.insert(members).values({
			nome: 'Nato', cognome: 'Da Contatto', codiceSocio: `AN${String(Date.now()).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`,
			leadCanaleId: canaleAndamento.id, leadDataContatto: '2026-09-01', dateOfBirth: '1992-04-03', sesso: 'M',
		}).returning();
		idSocio.push(socio.id);

		const res = await come('reception', { method: 'GET', url: '/api/lead/andamento' });
		assert.equal(res.statusCode, 200, res.body);
		const righe = res.json().righe.filter((r) => r.canale_id === canaleAndamento.id);
		assert.deepEqual(righe.map((r) => r.esito).sort(), ['aperto', 'perso', 'socio']);
		assert.equal(righe.find((r) => r.esito === 'perso').motivo, 'orari');
		const delSocio = righe.find((r) => r.esito === 'socio');
		assert.equal(delSocio.anno_nascita, 1992);
		assert.equal(delSocio.data_contatto, '2026-09-01');
		assert.ok(delSocio.socio_dal);
		// Niente nomi, niente recapiti: escono solo i campi dei conti.
		assert.deepEqual(Object.keys(righe[0]).sort(), ['anno_nascita', 'canale_id', 'data_contatto', 'esito', 'motivo', 'sesso', 'socio_dal']);
		assert.ok(res.json().canali.some((c) => c.id === canaleAndamento.id));
		void aperto;

		assert.equal((await come('istruttore', { method: 'GET', url: '/api/lead/andamento' })).statusCode, 200);
		assert.equal((await come('socio', { method: 'GET', url: '/api/lead/andamento' })).statusCode, 403);
	});
});

describe('gli stati di un lead', () => {
	const azione = (chi, id, nome, corpo = {}) => post(chi, `/api/lead/${id}/${nome}`, corpo);
	const diario = async (id) => db.select().from(leadAttivita).where(eq(leadAttivita.leadId, id)).orderBy(leadAttivita.createdDate);

	test('un lead nasce nuovo, e lo stato dall\'endpoint generico non si tocca', async () => {
		const lead = await nuovoLead();
		assert.equal(lead.stato, 'nuovo');
		const res = await come('reception', { method: 'PUT', url: `/api/entities/Lead/${lead.id}`, payload: { stato: 'non_interessato', tentativi_senza_risposta: 9 } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().stato, 'nuovo');
		assert.equal(res.json().tentativi_senza_risposta, 0);
	});

	test('ogni azione cambia lo stato e lascia una riga nel diario, firmata', async () => {
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

		const righe = await diario(lead.id);
		assert.deepEqual(righe.map((a) => a.tipo), ['tentativo', 'risposta', 'richiamo', 'chiusura', 'riapertura']);
		assert.equal(righe[1].nota, 'Chiede gli orari');
		assert.ok(righe.every((a) => a.autoreNome === 'Reception Lead'));

		const letto = await come('reception', { method: 'GET', url: `/api/lead/${lead.id}/attivita` });
		assert.equal(letto.json().attivita.length, 5);
	});

	test('troppi tentativi senza risposta, e da tanto: non raggiungibile da solo, una volta sola', async () => {
		const lead = await nuovoLead();
		await db.update(leads).set({
			stato: 'in_attesa', tentativiSenzaRisposta: 3, ultimoContattoIl: spostaGiorni(oggiIso(), -20),
		}).where(eq(leads.id, lead.id));

		const prima = await come('reception', { method: 'GET', url: '/api/lead/lavoro' });
		assert.equal(prima.statusCode, 200, prima.body);
		const chiuso = prima.json().leads.find((l) => l.id === lead.id);
		assert.equal(chiuso.stato, 'non_raggiungibile');
		assert.ok(prima.json().conteggi.chiusi >= 1);

		await come('reception', { method: 'GET', url: '/api/lead/lavoro' });
		const automatici = (await diario(lead.id)).filter((a) => a.tipo === 'stato_automatico');
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
