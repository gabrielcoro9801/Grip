/**
 * Il portale soci con dei dati veri da guardare a mano (docs/piani/portale.md, «Dati di prova»).
 *
 * Crea una socia con l'accesso al portale e, intorno a lei:
 * - un abbonamento in corso e uno vecchio (lo storico), e una sospensione fra dieci giorni;
 * - Pilates ogni settimana, con una sua prenotazione fissa con le date;
 * - Yoga ogni settimana, prenotato due volte nelle ultime settimane («I tuoi corsi»), e pieno
 *   dopodomani con lei in lista d'attesa;
 * - Functional fra tre giorni, con un posto che si è liberato e le è offerto (12 ore);
 * - Zumba fra quattro giorni, annullata dalla palestra, con la notifica.
 * Se la palestra non ha i contatti, ne scrive di finti.
 *
 * Come si usa (solo su grip_locale):
 *   cd server && npm run dati:portale            crea (rifà da capo se c'erano già)
 *   cd server && npm run dati:portale -- --togli  toglie tutto
 * Poi: portale con giulia.portale@grip.local / portale1234.
 */
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, sospensioni, rooms, categories, instructors, courses, events, sessions,
	bookings, notifiche, prenotazioniFisse, organizations,
} from '../src/db/schema/index.js';
import { prenota, disdici } from '../src/lib/prenotazioni.js';
import { creaFissa, avvisaAllungabili } from '../src/lib/prenotazioniFisse.js';
import { notifica, giornoEsteso } from '../src/lib/notifiche.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

// I dati di prova si riconoscono da qui: i soci dal codice, il resto dalla descrizione o dalle note.
const MARCA = 'DatiPortale';
const CODICE = 'PORTALE';
const EMAIL = 'giulia.portale@grip.local';
const PASSWORD = 'portale1234';
const GIORNI_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);
const giornoDi = (d) => GIORNI_EN[new Date(`${d}T12:00:00Z`).getUTCDay()];

async function togli() {
	const soci = await db.select({ id: members.id }).from(members).where(like(members.codiceSocio, `${CODICE}%`));
	const ids = soci.map((s) => s.id);
	const corsi = await db.select({ id: courses.id }).from(courses).where(eq(courses.description, MARCA));
	const idCorsi = corsi.map((c) => c.id);
	const eventi = idCorsi.length ? await db.select({ id: events.id }).from(events).where(inArray(events.courseId, idCorsi)) : [];
	const idEventi = eventi.map((e) => e.id);
	const lezioni = idEventi.length ? await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.eventId, idEventi)) : [];
	if (lezioni.length) await db.delete(bookings).where(inArray(bookings.sessionId, lezioni.map((l) => l.id)));
	if (ids.length) {
		await db.delete(bookings).where(inArray(bookings.memberId, ids));
		await db.delete(prenotazioniFisse).where(inArray(prenotazioniFisse.memberId, ids));
		await db.delete(notifiche).where(inArray(notifiche.memberId, ids));
		await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, ids));
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, ids));
	}
	if (lezioni.length) await db.delete(sessions).where(inArray(sessions.id, lezioni.map((l) => l.id)));
	if (idEventi.length) await db.delete(events).where(inArray(events.id, idEventi));
	if (idCorsi.length) await db.delete(courses).where(inArray(courses.id, idCorsi));
	await db.delete(categories).where(eq(categories.name, 'Benessere (prova)'));
	await db.delete(instructors).where(eq(instructors.notes, MARCA));
	await db.delete(rooms).where(eq(rooms.name, 'Sala 2 (prova)'));
	if (ids.length) await db.delete(members).where(inArray(members.id, ids));
	return ids.length;
}

/** Una serie settimanale (o una lezione singola) con le sue lezioni nelle date date. */
async function corso({ nome, categoria, istruttore, sala, ora, fine, capienza, date, settimanale = true, termine = 2 }) {
	const [c] = await db.insert(courses).values({ name: nome, description: MARCA, categoryId: categoria, instructorId: istruttore, disdettaEntroOre: termine }).returning();
	const [e] = await db.insert(events).values({
		courseId: c.id, roomId: sala, capacity: capienza, recurrenceType: settimanale ? 'weekly' : 'single',
		giorno: settimanale ? giornoDi(date[0]) : null, startDate: date[0], endCondition: settimanale ? 'by_date' : null,
		endDate: settimanale ? date.at(-1) : null, startTime: ora, endTime: fine,
	}).returning();
	const lezioni = await db.insert(sessions).values(date.map((d) => ({ eventId: e.id, date: d, startTime: ora, endTime: fine, roomId: sala, capacity: capienza }))).returning();
	return { corso: c, evento: e, lezioni };
}

const errore = (esito, cosa) => { if (esito?.errore) throw new Error(`${cosa}: ${esito.messaggio}`); return esito; };

try {
	const tolti = await togli();
	if (process.argv.includes('--togli')) {
		console.log(tolti ? 'Dati del portale tolti.' : 'Non c\'era niente da togliere.');
	} else {
		const persone = await db.insert(members).values([
			{ nome: 'Giulia', cognome: 'Bianchi', codiceSocio: `${CODICE}A`, email: EMAIL, phone: '333 1234567', dateOfBirth: '1990-04-12', address: 'Via Garibaldi 12, Padova', emergencyContactName: 'Marco', emergencyContactPhone: '333 7654321' },
			{ nome: 'Sara', cognome: 'Prova', codiceSocio: `${CODICE}B` },
			{ nome: 'Luca', cognome: 'Prova', codiceSocio: `${CODICE}C` },
		]).returning();
		const [giulia, sara, luca] = persone;
		await db.insert(staffAccounts).values({ nome: 'Giulia', email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 10), ruolo: 'member', linkedMemberId: giulia.id });
		await db.insert(subscriptions).values([
			{ memberId: giulia.id, planName: 'Open 6 mesi', startDate: fra(-150), endDate: fra(30), status: 'active' },
			{ memberId: giulia.id, planName: 'Open 3 mesi', startDate: fra(-245), endDate: fra(-151), status: 'active' },
			{ memberId: sara.id, planName: 'Open 6 mesi', startDate: fra(-30), endDate: fra(150), status: 'active' },
			{ memberId: luca.id, planName: 'Open 6 mesi', startDate: fra(-30), endDate: fra(150), status: 'active' },
		]);
		await db.insert(sospensioni).values({ memberId: giulia.id, dal: fra(10), al: fra(16), nota: 'Vacanza', autoreNome: 'Dati di prova' });

		const [sala] = await db.insert(rooms).values({ name: 'Sala 2 (prova)' }).returning();
		const [categoria] = await db.insert(categories).values({ name: 'Benessere (prova)', color: '#10b981' }).returning();
		const [istruttrice] = await db.insert(instructors).values({ nome: 'Elisa', cognome: 'Paccagnella', notes: MARCA }).returning();
		const base = { categoria: categoria.id, istruttore: istruttrice.id, sala: sala.id };

		// Pilates, ogni settimana da domani: la fissa di Giulia fino alla quarta lezione. La sessione
		// va oltre, e l'abbonamento anche: «Allunga» (la notifica, alla fine).
		const pilates = await corso({ ...base, nome: 'Pilates', ora: '18:30', fine: '19:30', capienza: 8, date: [1, 8, 15, 22, 29].map(fra) });
		errore(await creaFissa({ memberId: giulia.id, eventId: pilates.evento.id, al: fra(22), creataDa: 'Dati di prova' }), 'la fissa');

		// Yoga, ogni settimana: due volte prenotato di recente; dopodomani pieno, Giulia in lista.
		const yoga = await corso({ ...base, nome: 'Yoga', ora: '12:15', fine: '13:15', capienza: 2, date: [-12, -5, 2, 9].map(fra) });
		await db.insert(bookings).values(yoga.lezioni.slice(0, 2).map((l) => ({ sessionId: l.id, memberId: giulia.id, memberName: 'Giulia', status: 'confirmed' })));
		for (const chi of [sara, luca, giulia]) errore(await prenota({ sessionId: yoga.lezioni[2].id, memberId: chi.id }), 'yoga');

		// Functional fra tre giorni, un posto solo: Sara lo lascia, e a Giulia si offre.
		const functional = await corso({ ...base, nome: 'Functional', ora: '19:00', fine: '20:00', capienza: 1, date: [fra(3)], settimanale: false });
		const diSara = errore(await prenota({ sessionId: functional.lezioni[0].id, memberId: sara.id }), 'functional');
		errore(await prenota({ sessionId: functional.lezioni[0].id, memberId: giulia.id }), 'functional');
		errore(await disdici({ bookingId: diSara.creata.id }), 'functional');

		// Zumba fra quattro giorni: prenotata, poi annullata dalla palestra.
		const zumba = await corso({ ...base, nome: 'Zumba', ora: '19:00', fine: '20:00', capienza: 10, date: [fra(4)], settimanale: false });
		const diGiulia = errore(await prenota({ sessionId: zumba.lezioni[0].id, memberId: giulia.id }), 'zumba');
		await db.transaction(async (tx) => {
			await tx.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, zumba.lezioni[0].id));
			await tx.update(bookings).set({ status: 'cancelled', waitlistPosition: null }).where(eq(bookings.id, diGiulia.creata.id));
			await notifica(tx, [giulia.id], {
				tipo: 'lezione_annullata', lezioneId: zumba.lezioni[0].id, titolo: 'Lezione annullata: Zumba',
				testo: `La lezione di Zumba di ${giornoEsteso(fra(4))} alle 19:00 è stata annullata, e la tua prenotazione è stata cancellata. Ci scusiamo per il disagio.`,
			});
		});

		await avvisaAllungabili({ memberId: giulia.id });

		// I contatti della palestra, se non ci sono.
		const [ente] = await db.select().from(organizations).limit(1);
		if (ente && !ente.impostazioni?.contatti?.telefono) {
			await db.update(organizations).set({
				indirizzo: ente.indirizzo ?? 'Via Roma 1, Padova',
				impostazioni: { ...ente.impostazioni, contatti: { telefono: '049 123456', whatsapp: '333 1112233', email: 'info@palestra.local', orari: 'Lun-ven 8-21, sab 9-13' } },
			}).where(eq(organizations.id, ente.id));
		}
		console.log(`Fatto. Portale: ${EMAIL} / ${PASSWORD}`);
		console.log('Pilates fissa da allungare, Yoga in lista d\'attesa, Functional con un posto offerto, Zumba annullata, sospensione fra 10 giorni.');
	}
	await pool.end();
} catch (err) {
	console.error('Non riuscito:', err.cause?.message ?? err.message);
	await pool.end().catch(() => {});
	process.exit(1);
}
