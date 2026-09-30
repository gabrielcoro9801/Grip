// Riporta al giorno giusto le lezioni dei corsi settimanali salvate un giorno prima.
//
// Il perché e il come riconoscerle sono in `lib/dateSettimanali.js`. Le prenotazioni seguono
// la lezione per `session_id` e non si toccano.
//
// **Di norma non scrive niente**: elenca cosa sposterebbe. Si scrive solo con `--applica`, in
// una transazione sola — o tutto o niente. Prima di applicarlo in produzione: un backup.
//
// Uso:
//   npm run db:ripara-date-settimanali                  (solo elenco)
//   npm run db:ripara-date-settimanali -- --applica     (scrive)
//   railway run npm --prefix server run db:ripara-date-settimanali      (per la produzione)
import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { events, sessions } from './db/schema/index.js';
import { annunciaDatabase } from './lib/descriviDatabase.js';
import { esaminaEvento } from './lib/dateSettimanali.js';

const APPLICA = process.argv.includes('--applica');

annunciaDatabase();

const settimanali = await db.select().from(events).where(eq(events.recurrenceType, 'weekly'));

const daSpostare = [];
let sfalsati = 0;
for (const evento of settimanali) {
	const lezioni = await db.select({ id: sessions.id, date: sessions.date }).from(sessions).where(eq(sessions.eventId, evento.id));
	const esame = esaminaEvento(
		{
			days_of_week: evento.daysOfWeek,
			start_date: evento.startDate,
			end_condition: evento.endCondition,
			end_date: evento.endDate,
			occurrence_count: evento.occurrenceCount,
		},
		lezioni,
	);

	if (esame.esito === 'incerto') {
		console.log(`? evento ${evento.id}: tante lezioni sul giorno giusto quante sul giorno prima — da controllare a mano.`);
		continue;
	}
	if (esame.esito !== 'sfalsato') continue;

	sfalsati++;
	console.log(`• evento ${evento.id} (${(evento.daysOfWeek ?? []).join(', ')}): ${esame.daSpostare.length} lezioni da spostare di un giorno avanti.`);
	for (const l of esame.fuoriSchema) {
		console.log(`    lezione ${l.id} del ${l.date}: non segue lo schema dell'evento (spostata a mano?) — lasciata com'è.`);
	}
	daSpostare.push(...esame.daSpostare.map((l) => l.id));
}

console.log(`\nEventi settimanali: ${settimanali.length}. Sfalsati: ${sfalsati}. Lezioni da spostare: ${daSpostare.length}.`);

if (!daSpostare.length) {
	await pool.end();
	process.exit(0);
}

if (!APPLICA) {
	console.log('Nessuna modifica fatta. Per applicarle: npm run db:ripara-date-settimanali -- --applica');
	await pool.end();
	process.exit(0);
}

const spostate = await db.transaction(async (tx) => {
	let totale = 0;
	// A pezzi, per non mandare al database un elenco di id sterminato.
	for (let i = 0; i < daSpostare.length; i += 500) {
		const pezzo = daSpostare.slice(i, i + 500);
		const righe = await tx
			.update(sessions)
			.set({ date: sql`${sessions.date} + 1` })
			.where(inArray(sessions.id, pezzo))
			.returning({ id: sessions.id });
		totale += righe.length;
	}
	if (totale !== daSpostare.length) {
		throw new Error(`Spostate ${totale} lezioni invece di ${daSpostare.length}: annullo tutto.`);
	}
	return totale;
});

console.log(`Fatto: ${spostate} lezioni spostate di un giorno avanti.`);
await pool.end();
process.exit(0);
