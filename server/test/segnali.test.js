// Il motore dei segnali contro le rotte vere: le cose da fare di ogni socio, il contatto del
// bancone che nasconde solo il suo segnale, la ricerca globale e i permessi. Gli avvisi di Da fare
// hanno il loro file (da-fare.test.js).
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, ingressi, attivita, memberDocuments,
} from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-segnali-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);

let app;
const token = {};
const id = { soci: {}, account: [], persone: [] };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const persona = async (chiave) => {
	const [s] = await db.select({ personaId: members.personaId }).from(members).where(eq(members.id, id.soci[chiave])).limit(1);
	return s.personaId;
};
const elenco = async (chi = 'reception') => (await come(chi, 'GET', '/api/segnali?tipo=soci')).json();
const riga = (dati, chiave) => dati.persone.find((p) => p.socio_id === id.soci[chiave]);

// "Vede ma non modifica": fino alla fase 3 del CRM era l'istruttore predefinito, e questi test lo
// usano così. Oggi l'istruttore ha la sua vista e non le anagrafiche: gli si ridà qui la sola lettura.
const SOLA_LETTURA = { ...PERMESSI_PREDEFINITI, istruttore: { crm_members: ['view'], crm_documents: ['view'], crm_leads: ['view'], calendar: ['view', 'edit'] } };
const matriceDiProva = () => impostaMatrice({ permessi: SOLA_LETTURA, capacita: {} });

before(async () => {
	matriceDiProva();
	app = buildApp({ logger: false });
	await app.ready();
	const nomi = ['Scade', 'Contattato', 'Rimandato', 'Saltalezioni', 'Regolare'];
	const soci = await db.insert(members).values(nomi.map((n, i) => ({
		nome: n, cognome: `Segnali${lettere}`, codiceSocio: `SG${'ABCDE'[i]}${lettere}`, phone: `+39347${String(t).slice(-6)}${i}`,
		codiceFiscale: i === 0 ? `SG${lettere}X` : null,
	}))).returning();
	soci.forEach((s, i) => { id.soci[nomi[i].toLowerCase()] = s.id; id.persone.push(s.personaId); });
	await db.insert(subscriptions).values(soci.map((s, i) => ({
		memberId: s.id, planName: 'Mensile', startDate: '2025-01-01', endDate: i < 3 ? fra(3) : fra(200),
	})));
	// Documenti in regola per tutti: altrimenti ognuno avrebbe "documento mancante".
	await db.insert(memberDocuments).values(soci.flatMap((s) => [
		{ memberId: s.id, documentType: 'certificato_medico', expiryDate: fra(300) },
		{ memberId: s.id, documentType: 'documento_identita', expiryDate: fra(3000) },
	]));
	// Tutti entrano spesso: nessuno è assente o in calo, i segnali sono solo quelli voluti.
	await db.insert(ingressi).values(soci.flatMap((s) => [1, 3, 5, 8].map((g) => ({
		memberId: s.id, entratoAlle: new Date(`${fra(-g)}T08:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test',
	}))));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Segnali', email: `sg.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Istruttore Segnali', email: `sg.ist.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Socio Segnali', email: `sg.soc.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: soci[4].id },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.istruttore = await login(account[1].email);
	token.socio = await login(account[2].email);
});

after(async () => {
	ripristinaMatricePredefinita();
	const tutti = Object.values(id.soci);
	await db.delete(ingressi).where(inArray(ingressi.memberId, tutti));
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await db.delete(persone).where(inArray(persone.id, id.persone));
	await app.close();
	await pool.end();
});

describe('le cose da fare di un socio', () => {
	test('chi scade fra 3 giorni ha il rinnovo da fare, con il perché in parole; lo stato resta attivo', async () => {
		const dati = await elenco();
		const scade = riga(dati, 'scade');
		assert.equal(scade.fase, 'attivo', 'in scadenza non è uno stato: è una cosa da fare');
		assert.deepEqual(scade.da_fare, ['in_scadenza']);
		assert.equal(scade.perche, 'scade tra 3 giorni');
		assert.equal(scade.scadenza, fra(3));
		assert.deepEqual(riga(dati, 'regolare').da_fare, [], 'chi non ha niente da fare');
		assert.ok(dati.conteggi.segnali.in_scadenza >= 3);
		assert.ok(!('linee' in dati.conteggi), 'le linee del vecchio Da fare non ci sono più');
		assert.ok(!('grezzi' in scade), 'i dati grezzi restano sul server');
	});

	test('"proposto rinnovo" va nel diario, con il suo segnale, e al bancone lo nasconde per una settimana', async () => {
		const pid = await persona('contattato');
		const r = await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'di_persona', esito: 'proposto_rinnovo', segnale: 'in_scadenza', nota: 'Ci pensa' });
		assert.equal(r.statusCode, 201, r.body);
		assert.deepEqual(riga(await elenco(), 'contattato').da_fare, ['in_scadenza'], 'per lo staff non si nasconde: l\'avviso di Da fare si chiude da sé');
		const scheda = (await come('reception', 'GET', `/api/segnali?persona=${pid}&pubblico=bancone`)).json().persone[0];
		assert.equal(scheda.segnali.find((s) => s.codice === 'in_scadenza').nascosto_fino, fra(7));
		const diario = (await come('reception', 'GET', `/api/persone/${pid}/diario`)).json().attivita;
		assert.deepEqual(diario.filter((a) => a.autore_nome !== 'Sistema').map((a) => [a.tipo, a.esito, a.nota, a.riferimento]), [['contatto', 'proposto_rinnovo', 'Ci pensa', { segnali: ['in_scadenza'] }]]);
	});

	test('il "Fatto" vale per un segnale che la persona ha adesso, e il rimando non c\'è più', async () => {
		const pid = await persona('rimandato');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono' })).statusCode, 400, 'senza segnale');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', segnale: 'compleanno' })).statusCode, 400, 'un segnale che non ha');
		const r = await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', segnali: ['in_scadenza'] });
		assert.equal(r.statusCode, 201, r.body);
		assert.equal(r.json().attivita.esito, 'fatto');
		assert.deepEqual(riga(await elenco(), 'rimandato').da_fare, ['in_scadenza'], 'per lo staff un contatto non nasconde niente');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/rimanda`, { giorni: 2 })).statusCode, 404);
	});

	test('un contatto senza esito o canale validi si rifiuta', async () => {
		const pid = await persona('scade');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'piccione', segnale: 'in_scadenza' })).statusCode, 400);
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', esito: 'boh', segnale: 'in_scadenza' })).statusCode, 400);
	});
});

describe('filtri dell\'elenco', () => {
	test('per stato e per segnale, solo soci', async () => {
		const perStato = (await come('reception', 'GET', '/api/segnali?tipo=soci&fase=attivo')).json();
		assert.ok(perStato.persone.every((p) => p.fase === 'attivo' && p.socio_id));
		assert.ok(riga(perStato, 'contattato'), 'l\'elenco mostra anche chi è già stato seguito');
		const perSegnale = (await come('reception', 'GET', '/api/segnali?tipo=soci&segnale=in_scadenza')).json();
		assert.ok(riga(perSegnale, 'scade'));
		assert.ok(!riga(perSegnale, 'saltalezioni'));
		assert.equal((await come('reception', 'GET', '/api/segnali?fase=in_scadenza')).statusCode, 400, 'non è più uno stato');
		assert.equal((await come('reception', 'GET', '/api/segnali?fase=boh')).statusCode, 400);
		assert.equal((await come('reception', 'GET', '/api/segnali?persona=boh')).statusCode, 400);
	});
});

describe('la ricerca globale', () => {
	test('trova per telefono scritto in un altro formato, per codice socio e per codice fiscale', async () => {
		const cerca = async (q) => (await come('reception', 'GET', `/api/persone/cerca?q=${encodeURIComponent(q)}`)).json().risultati;
		const cifre = `347${String(t).slice(-6)}0`;
		const perTelefono = await cerca(`${cifre.slice(0, 3)} ${cifre.slice(3, 6)} ${cifre.slice(6)}`);
		assert.deepEqual(perTelefono.map((r) => r.socio_id), [id.soci.scade]);
		assert.equal(perTelefono[0].tipo, 'socio');
		assert.deepEqual((await cerca(`0039${cifre}`)).map((r) => r.socio_id), [id.soci.scade]);
		assert.deepEqual((await cerca(`SGB${lettere}`)).map((r) => r.socio_id), [id.soci.contattato]);
		assert.deepEqual((await cerca(`sg${lettere}x`)).map((r) => r.socio_id), [id.soci.scade], 'il codice fiscale, anche minuscolo');
		assert.ok((await cerca(`segnali${lettere} rimandato`)).some((r) => r.socio_id === id.soci.rimandato), 'le parole in qualunque ordine');
		assert.deepEqual(await cerca('x'), []);
	});
});

describe('i permessi', () => {
	test('il socio non legge i segnali, non cerca e non registra contatti', async () => {
		assert.equal((await come('socio', 'GET', '/api/segnali')).statusCode, 403);
		assert.equal((await come('socio', 'GET', '/api/persone/cerca?q=Scade')).statusCode, 403);
		assert.equal((await come('socio', 'POST', `/api/persone/${await persona('scade')}/contatti`, { canale: 'telefono', segnale: 'in_scadenza' })).statusCode, 403);
	});

	test('chi vede e basta legge, ma non segna i "Fatto"', async () => {
		assert.equal((await come('istruttore', 'GET', '/api/segnali')).statusCode, 200);
		const pid = await persona('scade');
		assert.equal((await come('istruttore', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', segnale: 'in_scadenza' })).statusCode, 403);
	});

	test('chi segue solo i contatti non riceve i soci, né li trova', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_leads: ['view'] } }, capacita: {} });
		try {
			const dati = (await come('istruttore', 'GET', '/api/segnali')).json();
			assert.ok(dati.persone.every((p) => !p.socio_id));
			const trovati = (await come('istruttore', 'GET', `/api/persone/cerca?q=${encodeURIComponent(`Segnali${lettere}`)}`)).json().risultati;
			assert.deepEqual(trovati, []);
		} finally {
			matriceDiProva();
		}
	});
});

describe('il bancone', () => {
	test('la verifica porta "proponi il rinnovo"; segnato nel diario, non si ripropone', async () => {
		const verifica = async () => (await come('reception', 'POST', '/api/ingressi/verifica', { member_id: id.soci.scade })).json();
		const prima = await verifica();
		assert.deepEqual(prima.segnali, [{ codice: 'in_scadenza', motivo: 'Scade tra 3 giorni: proponi il rinnovo', azioni: ['proposta_rinnovo'] }]);
		assert.equal(prima.socio.persona_id, await persona('scade'));
		const r = await come('reception', 'POST', `/api/persone/${prima.socio.persona_id}/contatti`, { canale: 'di_persona', esito: 'proposto_rinnovo', segnale: 'in_scadenza' });
		assert.equal(r.statusCode, 201);
		assert.deepEqual((await verifica()).segnali, []);
	});

	test('chi non viene più, nelle statistiche, lo dice il motore', async () => {
		const s = (await come('reception', 'GET', '/api/ingressi/statistiche?giorni=30')).json();
		assert.equal(s.sogliaRischio, 14);
		assert.ok(!s.rischio.some((x) => Object.values(id.soci).includes(x.id)), 'tutti i nostri entrano spesso');
	});
});

describe('il diario resta pulito', () => {
	test('le righe scritte dai test hanno un autore', async () => {
		// Il giro, se un altro file lo lancia intanto, scrive le sue righe "Sistema": non sono dei test.
		const righe = (await db.select().from(attivita).where(inArray(attivita.personaId, id.persone)))
			.filter((r) => !['segnale_aperto', 'segnale_chiuso', 'archiviazione_automatica'].includes(r.tipo));
		assert.ok(righe.every((r) => r.autoreNome === 'Reception Segnali'));
	});
});
