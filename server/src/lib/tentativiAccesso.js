/**
 * Quante volte si può sbagliare la password, e per quanto si resta fuori dopo.
 *
 * Il login non aveva nessun limite: le password si provavano senza freni. Si contano i
 * tentativi **falliti** in due modi, perché uno solo si aggira:
 *
 * - per email, così chi prova tante password sullo stesso account da indirizzi diversi si
 *   ferma lo stesso;
 * - per IP, così chi prova la stessa password su tante email da un posto solo si ferma.
 *
 * Un accesso riuscito azzera il conto di quell'email. I conti stanno in memoria: il servizio
 * gira in una sola istanza, e un riavvio che li azzera non è un problema (con più istanze
 * servirebbe un archivio comune, per esempio una tabella).
 */

export const FINESTRA_MS = 15 * 60 * 1000;
export const MASSIMO_PER_EMAIL = 10;
export const MASSIMO_PER_IP = 30;

const falliti = new Map(); // chiave → istanti dei tentativi falliti nella finestra

function recenti(chiave, adesso) {
	const lista = (falliti.get(chiave) ?? []).filter((t) => adesso - t < FINESTRA_MS);
	if (lista.length) falliti.set(chiave, lista);
	else falliti.delete(chiave);
	return lista;
}

const chiavi = (email, ip) => [
	{ chiave: `email:${String(email ?? '').trim().toLowerCase()}`, massimo: MASSIMO_PER_EMAIL },
	...(ip ? [{ chiave: `ip:${ip}`, massimo: MASSIMO_PER_IP }] : []),
];

/** Secondi da aspettare prima di poter riprovare, o 0 se si può provare adesso. */
export function secondiDiAttesa(email, ip, adesso = Date.now()) {
	let attesa = 0;
	for (const { chiave, massimo } of chiavi(email, ip)) {
		const lista = recenti(chiave, adesso);
		if (lista.length >= massimo) {
			// Si riprova quando il tentativo più vecchio fra gli ultimi `massimo` esce dalla finestra.
			const libero = lista[lista.length - massimo] + FINESTRA_MS;
			attesa = Math.max(attesa, Math.ceil((libero - adesso) / 1000));
		}
	}
	return attesa;
}

export function registraFallimento(email, ip, adesso = Date.now()) {
	// Chi prova migliaia di email diverse lascerebbe una chiave per ognuna: ogni tanto si
	// ripulisce tutto quello che è uscito dalla finestra, perché la memoria non cresca senza fine.
	if (falliti.size > 10_000) for (const chiave of [...falliti.keys()]) recenti(chiave, adesso);
	for (const { chiave } of chiavi(email, ip)) {
		falliti.set(chiave, [...recenti(chiave, adesso), adesso]);
	}
}

export function registraSuccesso(email) {
	falliti.delete(chiavi(email, null)[0].chiave);
}

/** Solo per i test. */
export function azzeraTentativi() {
	falliti.clear();
}
