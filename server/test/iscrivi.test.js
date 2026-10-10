// Il flusso "Iscrivi": anagrafica, abbonamento, certificato, privacy e accesso al portale in una
// transazione. O si salva tutto, o niente; un ex socio che entra direttamente ritrova la sua scheda.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, memberDocuments, consensi, attivita, plans, auditLogs,
} from '../src/db/schema/index.js';
import { carattereDiControllo } from '../../shared/anagrafica.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { dataFineAbbonamento } from '../../shared/abbonamenti.js';

const PASSWORD = 'prova-iscrivi-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]).slice(-6);
// Codici fiscali validi e solo di questo test: i file girano in parallelo sullo stesso database.
// La lettera è il mese di nascita (B, C, D: febbraio, marzo, aprile).
const cf = (mese) => { const primi = `${lettere}85${mese}10A562`; return primi + carattereDiControllo(primi); };
const CF_NUOVO = cf('B');
const CF_EX = cf('C');
const CF_FALLITO = cf('D');
const emailNuovo = `iscrivi.nuovo.${t}@test.local`;

let app;
let token;
const id = { account: null, tipo: null, sospeso: null };
const iscrivi = (corpo) => app.inject({ method: 'POST', url: '/api/iscrivi', payload: corpo, headers: { authorization: `Bearer ${token}` } });
const anagrafica = (codice, extra = {}) => ({ nome: 'Nuova', cognome: `Iscritta${lettere}`, sesso: 'F', codice_fiscale: codice, date_of_birth: '1990-05-05', ...extra });
const sociDiProva = () => db.select().from(members).where(sql`upper(${members.codiceFiscale}) in (${CF_NUOVO}, ${CF_EX}, ${CF_FALLITO})`);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [account] = await db.insert(staffAccounts).values({
		nome: 'Reception Iscrivi', email: `iscrivi.reception.${t}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception',
	}).returning();
	id.account = account.id;
	token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.email, password: PASSWORD } })).json().token;
	const [tipo, sospeso] = await db.insert(plans).values([
		{ name: `Mensile iscrivi ${t}`, price: 45, durataValore: 1, durataUnita: 'mesi' },
		{ name: `Sospeso iscrivi ${t}`, price: 45, durataValore: 1, durataUnita: 'mesi', stato: 'sospeso' },
	]).returning();
	id.tipo = tipo.id; id.sospeso = sospeso.id;
});

after(async () => {
	const soci = await sociDiProva();
	const idSoci = soci.map((s) => s.id);
	if (idSoci.length) {
		await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, idSoci));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, idSoci));
		await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, idSoci));
		await db.delete(auditLogs).where(inArray(auditLogs.entitaId, idSoci));
		await db.delete(consensi).where(inArray(consensi.personaId, soci.map((s) => s.personaId)));
		await db.delete(attivita).where(inArray(attivita.personaId, soci.map((s) => s.personaId)));
		await db.delete(members).where(inArray(members.id, idSoci));
	}
	await db.delete(plans).where(inArray(plans.id, [id.tipo, id.sospeso]));
	await db.delete(staffAccounts).where(eq(staffAccounts.id, id.account));
	await app.close();
	await pool.end();
});

describe('iscrivi in un passo', () => {
	test('senza l\'informativa privacy firmata non si iscrive', async () => {
		assert.equal((await iscrivi({ anagrafica: anagrafica(CF_FALLITO) })).statusCode, 400);
	});

	test('un pezzo che non va annulla tutto: nessun socio a metà', async () => {
		const res = await iscrivi({ anagrafica: anagrafica(CF_FALLITO), informativa_privacy: true, abbonamento: { plan_id: id.sospeso } });
		assert.equal(res.statusCode, 400, res.body);
		const senzaEmail = await iscrivi({ anagrafica: anagrafica(CF_FALLITO), informativa_privacy: true, portale: { password: PASSWORD } });
		assert.equal(senzaEmail.statusCode, 400);
		const certificatoSenzaScadenza = await iscrivi({ anagrafica: anagrafica(CF_FALLITO), informativa_privacy: true, certificato: { file_url: '/uploads/cert.pdf' } });
		assert.equal(certificatoSenzaScadenza.statusCode, 400);
		// Un consenso promozionale dato in reception vale solo con il modulo firmato.
		const consensoSenzaModulo = await iscrivi({ anagrafica: anagrafica(CF_FALLITO), informativa_privacy: true, consensi: { marketing_email: true } });
		assert.equal(consensoSenzaModulo.statusCode, 400);
		assert.match(consensoSenzaModulo.json().error, /modulo firmato/);
		assert.deepEqual((await sociDiProva()).filter((s) => s.codiceFiscale === CF_FALLITO), []);
	});

	test('tutto insieme: socio, abbonamento, certificato, privacy, consensi e accesso al portale', async () => {
		const inizio = oggiIso();
		const res = await iscrivi({
			anagrafica: anagrafica(CF_NUOVO, { email: emailNuovo, phone: '347 555 1234' }),
			abbonamento: { plan_id: id.tipo, start_date: inizio },
			certificato: { file_url: '/uploads/certificato-prova.pdf', file_name: 'certificato.pdf', expiry_date: spostaGiorni(inizio, 365) },
			informativa_privacy: true,
			consensi: { marketing_email: true, marketing_sms: false },
			modulo_consensi: { file_url: '/uploads/modulo-consensi.pdf', file_name: 'modulo.pdf' },
			portale: { password: PASSWORD },
		});
		assert.equal(res.statusCode, 201, res.body);
		const { member, riattivato, accesso_portale: accesso } = res.json();
		assert.equal(riattivato, false);
		assert.equal(accesso, 'creato');
		assert.equal(member.gdpr_consent, true);
		assert.equal(member.gdpr_consent_date, inizio);

		const [abbonamento] = await db.select().from(subscriptions).where(eq(subscriptions.memberId, member.id));
		assert.equal(abbonamento.endDate, dataFineAbbonamento(inizio, 1, 'mesi'));
		assert.equal(Number(abbonamento.pricePaid), 45);
		const documenti = await db.select().from(memberDocuments).where(eq(memberDocuments.memberId, member.id));
		const documento = documenti.find((d) => d.documentType === 'certificato_medico');
		assert.equal(documento.caricatoDa, 'Reception Iscrivi');
		// Il modulo dei consensi finisce fra i documenti, ed è la prova del "sì".
		const modulo = documenti.find((d) => d.documentType === 'consenso_marketing');
		assert.ok(modulo);
		const scelte = await db.select().from(consensi).where(eq(consensi.personaId, member.persona_id));
		assert.deepEqual(scelte.map((c) => [c.tipo, c.valore, c.fonte, c.documentoId]).sort(), [['marketing_email', true, 'reception', modulo.id], ['marketing_sms', false, 'reception', null]]);
		const diario = await db.select().from(attivita).where(eq(attivita.personaId, member.persona_id));
		// Le righe "Da fare" del giro (se un altro file lo lancia intanto) non sono dell'iscrizione.
		assert.deepEqual(diario.filter((a) => a.autoreNome !== 'Sistema').map((a) => [a.tipo, a.esito]), [['iscrizione', 'nuovo']]);

		// Entra nel portale con la password data in reception, e deve cambiarla.
		const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: emailNuovo, password: PASSWORD } });
		assert.equal(login.statusCode, 200, login.body);
		assert.equal(login.json().user.password_da_cambiare, true);
	});

	test('lo stesso codice fiscale, ancora socio: non nasce un doppione', async () => {
		const res = await iscrivi({ anagrafica: anagrafica(CF_NUOVO), informativa_privacy: true });
		assert.equal(res.statusCode, 409);
		assert.ok(res.json().socio_id);
	});

	test('un ex socio che entra direttamente ritrova la sua scheda e il suo codice', async () => {
		const [ex] = await db.insert(members).values({ nome: 'Ex', cognome: `Socio${lettere}`, codiceSocio: `IX${lettere}`, codiceFiscale: CF_EX, archiviatoIl: '2025-06-30' }).returning();
		// Con l'abbonamento: la vendita deve vedere il socio già riattivato nella stessa transazione.
		const res = await iscrivi({ anagrafica: anagrafica(CF_EX, { nome: 'Ex', cognome: `Socio${lettere}` }), informativa_privacy: true, abbonamento: { plan_id: id.tipo } });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().riattivato, true);
		assert.equal(res.json().member.id, ex.id);
		assert.equal(res.json().member.codice_socio, ex.codiceSocio);
		assert.equal(res.json().member.archiviato_il, null);
		assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.memberId, ex.id))).length, 1);
	});
});
