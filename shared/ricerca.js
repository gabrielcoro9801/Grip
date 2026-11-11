// La ricerca di un socio per nome, email, codice o telefono.
//
// Si scrive come viene: «Colombo Alessandro» o «colombo ale» trovano Alessandro Colombo, «Niccolo»
// trova Niccolò, «D’Angelo» con l'apostrofo del telefono trova D'Angelo. Ogni parola scritta deve
// comparire in uno dei campi, in qualunque ordine. Il telefono conta da tre cifre in su, spazi e
// prefisso a parte. Pura, senza React: la usano l'elenco dei soci e il server.

/** Minuscolo, senza accenti, un solo apostrofo, spazi ridotti. */
export function normalizzaRicerca(testo) {
	return String(testo ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[’ʼ‘]/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

const soloCifre = (testo) => String(testo ?? '').replace(/\D/g, '');
// Un testo fatto solo di cifre e dei segni con cui si scrive un numero: «+39 340 123 4567».
const SEMBRA_UN_TELEFONO = /^[\d\s+\-./()]+$/;

/**
 * Se il socio corrisponde a quello che è stato scritto. Un testo vuoto trova tutti.
 * @param {{ nome?: string, email?: string, codice_socio?: string, telefono?: string }} socio
 * @param {string} testo
 */
export function corrispondeRicerca(socio, testo) {
	const cerca = normalizzaRicerca(testo);
	if (!cerca) return true;
	const telefono = soloCifre(socio.telefono);
	const nelTelefono = (cifre) => cifre.length >= 3 && telefono.includes(cifre);
	if (SEMBRA_UN_TELEFONO.test(cerca) && nelTelefono(soloCifre(cerca))) return true;
	const campi = [socio.nome, socio.email, socio.codice_socio].map(normalizzaRicerca).filter(Boolean);
	return cerca.split(' ').every((parola) => campi.some((c) => c.includes(parola)) || nelTelefono(soloCifre(parola)));
}
