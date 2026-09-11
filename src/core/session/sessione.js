import { leggiInSicurezza, scriviInSicurezza } from './archivio.js';

/**
 * Chi è connesso, da che parte, e dove si ricorda il suo token.
 *
 * ## Due sessioni, due chiavi
 *
 * Prima ce n'era una sola, `grip_auth_token`, per lo staff e per i soci. Sembra un dettaglio
 * e non lo è: chi lavora in palestra e ha anche un suo abbonamento non poteva tenere aperti
 * il gestionale e il portale nello stesso browser, perché il secondo accesso sovrascriveva
 * il token del primo.
 *
 * Quale chiave si usa non si decide guardando dentro al token, ma in base all'**area** in
 * cui l'applicazione sta girando. È un'informazione che core/ non può ricavare da sé — non
 * sa cosa sia un indirizzo web, e su un telefono non ce ne sarebbe uno — quindi gliela passa
 * chi avvia l'interfaccia.
 *
 * ## Perché il token sta in memoria
 *
 * L'archivio è asincrono (vedi `archivio.js`), ma il token serve **sincrono**: lo legge
 * `authHeaders()` a ogni singola chiamata all'API, e renderla asincrona significherebbe
 * spargere `await` su tutto il codice per un valore che non cambia mai durante l'uso.
 *
 * Si legge quindi una volta sola all'avvio, con `inizializzaSessione()`, e da lì in poi vive
 * in memoria; le scritture aggiornano prima la memoria e poi, senza farsi aspettare,
 * l'archivio. L'unico vincolo è che `inizializzaSessione()` venga completata **prima** del
 * primo disegno — altrimenti chi era connesso vedrebbe per un istante la schermata di
 * accesso.
 */

const CHIAVI = {
	staff: 'grip_staff_token',
	member: 'grip_member_token',
};

// La chiave di quando era una sola. Serve solo alla migrazione qui sotto, e si potrà
// togliere — insieme a `migraSessioneVecchia` — passati alcuni mesi dal rilascio di
// settembre 2026: a quel punto chi non è più tornato dovrà comunque rifare l'accesso.
const CHIAVE_VECCHIA = 'grip_auth_token';

let areaCorrente = 'staff';
const inMemoria = { staff: null, member: null };

/**
 * Dice a quale delle due applicazioni appartengono le chiamate che seguono.
 * La chiama chi avvia l'interfaccia, una volta sola, prima del primo disegno.
 */
export function impostaArea(area) {
	if (!CHIAVI[area]) throw new Error(`Area sconosciuta: ${area}`);
	areaCorrente = area;
}

export function areaAttiva() {
	return areaCorrente;
}

/**
 * Porta avanti chi era già connesso quando la chiave era una sola.
 *
 * Il token vecchio viene copiato in **entrambe** le chiavi nuove, e quella vecchia
 * cancellata. Dare lo stesso token a tutte e due sembra sbagliato, ed è invece la cosa
 * semplice che funziona: nessuno deve aprire il token e interpretarne il contenuto — cosa
 * che richiederebbe di decodificarlo e di fidarsene — perché a dire di chi sia ci pensa
 * `/api/auth/me`, che rilegge l'account dal database. L'area a cui non appartiene lo scarta
 * al primo controllo e cancella la propria chiave.
 *
 * In pratica: chi era dentro resta dentro, e chi era entrato come socio, la prima volta che
 * apre il gestionale, trova la schermata di accesso — che è il comportamento giusto.
 */
async function migraSessioneVecchia() {
	const vecchio = await leggiInSicurezza(CHIAVE_VECCHIA);
	if (!vecchio) return;

	const giaSeparate = (await leggiInSicurezza(CHIAVI.staff)) || (await leggiInSicurezza(CHIAVI.member));
	if (!giaSeparate) {
		await scriviInSicurezza(CHIAVI.staff, vecchio);
		await scriviInSicurezza(CHIAVI.member, vecchio);
	}
	await scriviInSicurezza(CHIAVE_VECCHIA, null);
}

/**
 * Legge le sessioni dall'archivio e le porta in memoria. Da attendere prima di disegnare.
 */
export async function inizializzaSessione() {
	await migraSessioneVecchia();
	inMemoria.staff = await leggiInSicurezza(CHIAVI.staff);
	inMemoria.member = await leggiInSicurezza(CHIAVI.member);
}

export function getToken() {
	return inMemoria[areaCorrente];
}

export function setToken(token) {
	inMemoria[areaCorrente] = token ?? null;
	// Non si aspetta la scrittura: il token è già valido in memoria, e far attendere un
	// login al disco non serve a nessuno. Se la scrittura fallisce, `scriviInSicurezza` non
	// solleva: l'accesso vale per questa visita e non verrà ricordato alla prossima.
	void scriviInSicurezza(CHIAVI[areaCorrente], token ?? null);
}

/** Solo per i test: rimette il modulo come appena caricato. */
export function azzeraSessionePerTest() {
	areaCorrente = 'staff';
	inMemoria.staff = null;
	inMemoria.member = null;
}
