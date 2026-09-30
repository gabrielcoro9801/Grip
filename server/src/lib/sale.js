// Quanto è usata una sala: la domanda da cui dipende cosa se ne può fare.
//
// Serve in due posti — il server, che decide se una sala si elimina, si annulla o non si
// tocca, e la pagina delle sale, che lo mostra sul cestino — e prima erano due conti diversi.
// La pagina lo faceva sugli elenchi che aveva in memoria, troncati: poteva proporre "elimina"
// per una sala con un passato fuori lista, o "annulla" per una prenotata. Il server faceva
// fino a cinque query in fila, e riscriveva a mano la regola che `shared/sale.js` già aveva.
// Ora il conto è uno, qui, e la regola è quella condivisa.
import { and, count, eq, gte, inArray, max, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { events, sessions } from '../db/schema/index.js';
import { oggiIso } from '../../../shared/abbonamenti.js';

/**
 * L'ultimo giorno di un evento, o null se non si sa.
 *
 * Un evento cominciato ieri che finisce a dicembre è ancora in corso: guardare solo l'inizio
 * lo dava per concluso, e la sala sotto di lui risultava libera. Per le date personalizzate
 * l'inizio registrato è il giorno in cui si è aperto il modulo, non la prima lezione, quindi
 * si guarda l'ultima data. Un settimanale a occorrenze finisce con la sua ultima lezione.
 */
function fineEvento(evento, ultimaLezione) {
	if (evento.recurrenceType === 'custom') {
		const date = Array.isArray(evento.customDates) ? [...evento.customDates].sort() : [];
		return date.length ? String(date[date.length - 1]) : String(evento.startDate);
	}
	if (evento.recurrenceType === 'weekly') {
		if (evento.endCondition === 'by_date' && evento.endDate) return String(evento.endDate);
		return ultimaLezione ? String(ultimaLezione) : null;
	}
	return String(evento.startDate);
}

/**
 * L'uso di ogni sala: eventi e lezioni che l'hanno mai citata, e se è impegnata da oggi in avanti.
 *
 * "Da oggi in avanti" conta una lezione non disdetta di oggi o dopo, oppure un evento che non è
 * ancora finito — anche a lezioni tutte disdette o non ancora generate: è una cosa viva in
 * calendario, e chiudere la stanza sotto di lui lo lascerebbe senza posto.
 *
 * @param {string[]} [idSale] le sale da guardare; tutte se omesso.
 * @returns {Promise<Map<string, {eventi: number, lezioni: number, occupataDaQui: boolean}>>}
 */
export async function usoDelleSale(idSale, oggi = oggiIso()) {
	const soloQueste = (colonna) => (idSale ? inArray(colonna, idSale) : undefined);
	const uso = new Map();
	const riga = (id) => {
		if (!uso.has(id)) uso.set(id, { eventi: 0, lezioni: 0, occupataDaQui: false });
		return uso.get(id);
	};
	for (const id of idSale ?? []) riga(id);

	const [eventi, ultime, lezioni, future] = await Promise.all([
		db.select().from(events).where(soloQueste(events.roomId)),
		db.select({ evento: sessions.eventId, ultima: max(sessions.date) }).from(sessions).groupBy(sessions.eventId),
		db.select({ sala: sessions.roomId, quante: count() }).from(sessions).where(soloQueste(sessions.roomId)).groupBy(sessions.roomId),
		db.select({ sala: sessions.roomId, quante: count() }).from(sessions)
			.where(and(soloQueste(sessions.roomId), ne(sessions.status, 'cancelled'), gte(sessions.date, oggi)))
			.groupBy(sessions.roomId),
	]);

	const ultimaPerEvento = new Map(ultime.map((u) => [u.evento, u.ultima]));
	for (const e of eventi) {
		const r = riga(e.roomId);
		r.eventi += 1;
		const fine = fineEvento(e, ultimaPerEvento.get(e.id));
		if (fine === null || fine >= oggi) r.occupataDaQui = true;
	}
	for (const l of lezioni) riga(l.sala).lezioni = Number(l.quante);
	for (const f of future) if (Number(f.quante)) riga(f.sala).occupataDaQui = true;
	return uso;
}

/** L'uso di una sala sola. */
export async function usoDellaSala(idSala, oggi) {
	return (await usoDelleSale([idSala], oggi)).get(idSala);
}

/**
 * Esegue `fn` tenendo ferme le sale indicate, finché non ha finito.
 *
 * Annullare una sala e programmarci un evento erano "controllo, poi scrittura" in due richieste
 * senza nessun blocco: se arrivavano insieme, entrambe vedevano la sala libera e passavano
 * entrambe — la sala annullata si ritrovava un evento, o la sospesa una lezione. Qui chi tocca
 * una sala aspetta chi la sta già toccando, e i controlli del secondo vedono il lavoro del primo.
 *
 * È un lock *advisory* di Postgres, legato alla transazione: blocca solo chi chiede lo stesso
 * lock, non la riga. Un `FOR UPDATE` sulla sala avrebbe fatto aspettare anche la scrittura della
 * sala stessa, che passa da un'altra connessione — cioè uno stallo. Le sale si bloccano in
 * ordine, così due richieste su due sale non si aspettano a vicenda.
 */
export async function conSaleBloccate(idSale, fn) {
	const ids = [...new Set((idSale ?? []).filter(Boolean).map(String))].sort();
	if (!ids.length) return fn();
	return db.transaction(async (tx) => {
		// Chi aspetta tiene occupata una connessione, e chi lavora ne usa altre: con abbastanza
		// richieste in coda il pool si esaurirebbe e nessuno finirebbe più. Dopo cinque secondi
		// chi aspetta rinuncia, con un messaggio che dice di riprovare (routes/errorHandler.js).
		await tx.execute(sql`set local lock_timeout = '5s'`);
		for (const id of ids) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sala:${id}`}))`);
		return fn();
	});
}
