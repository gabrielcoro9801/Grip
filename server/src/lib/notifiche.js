// Scrivere un avviso a uno o più soci. Lo chiama chi fa la cosa da comunicare, dentro la sua
// stessa transazione: o la lezione è annullata e il socio lo sa, o nessuna delle due.
import { notifiche } from '../db/schema/index.js';

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** "lunedì 12 ottobre" da "2026-10-12". Il giorno della settimana si calcola in UTC: è una data, non un istante. */
export function giornoEsteso(iso) {
	const [a, m, g] = String(iso).slice(0, 10).split('-').map(Number);
	const giorno = new Date(Date.UTC(a, m - 1, g)).getUTCDay();
	return `${GIORNI[giorno]} ${g} ${MESI[m - 1]}`;
}

/**
 * @param tx       la transazione (o `db`)
 * @param idSoci   a chi; i doppioni si tolgono
 * @param avviso   { tipo, titolo, testo }
 * @returns quante notifiche ha scritto
 */
export async function notifica(tx, idSoci, { tipo, titolo, testo }) {
	const destinatari = [...new Set((idSoci ?? []).filter(Boolean))];
	if (!destinatari.length) return 0;
	await tx.insert(notifiche).values(destinatari.map((memberId) => ({ memberId, tipo, titolo, testo })));
	return destinatari.length;
}
