// Il fornitore finto: registra e basta. È quello che si usa quando gli invii veri sono spenti
// (INVII_REALI assente), per gli SMS finché non c'è un fornitore, e nei test.
//
// Stessa firma degli adattatori veri: invia({ canale, a, oggetto, testo, conf, segreto, intestazioni })
// → { idFornitore, costoCentesimi }. Non apre connessioni, non chiama nessuno.
import { randomUUID } from 'node:crypto';

// Gli ultimi messaggi "spediti" dal finto, per i test e per chi guarda i log in sviluppo.
// ponytail: in memoria e per processo; basta a provare il giro, non è un registro (quello è `messaggi`).
const ULTIMI = 50;
export const spediti = [];

export async function invia({ canale, a, oggetto = '', testo }) {
	spediti.push({ canale, a, oggetto, testo, il: new Date() });
	if (spediti.length > ULTIMI) spediti.shift();
	return { idFornitore: `finto-${randomUUID()}`, costoCentesimi: 0 };
}
