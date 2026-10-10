// Scrivere un avviso a uno o più soci. Lo chiama chi fa la cosa da comunicare, dentro la sua
// stessa transazione: o la lezione è annullata e il socio lo sa, o nessuna delle due.
//
// È il punto d'ingresso unico degli avvisi: la notifica nel portale parte sempre, come prima;
// email e SMS si aggiungono solo per gli avvisi che hanno un playbook (`evento`), e solo se la
// palestra lo ha acceso (lib/invii.js, con le sue serrature). Si accodano nella stessa transazione.
import { notifiche } from '../db/schema/index.js';
import { accodaAvviso } from './invii.js';

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
 * @param altri    { evento, riferimento } — il playbook immediato (shared/comunicazioni.js) per
 *                 email e SMS, e l'evento che lo fa partire una volta sola (la lezione, la prenotazione)
 * @returns quante notifiche ha scritto
 */
export async function notifica(tx, idSoci, { tipo, titolo, testo }, { evento = null, riferimento = null } = {}) {
	const destinatari = [...new Set((idSoci ?? []).filter(Boolean))];
	if (!destinatari.length) return 0;
	await tx.insert(notifiche).values(destinatari.map((memberId) => ({ memberId, tipo, titolo, testo })));
	if (evento) await accodaAvviso(tx, evento, destinatari, { titolo, testo }, riferimento ?? tipo);
	return destinatari.length;
}
