// Configurazione dell'ambiente, verificata all'avvio.
//
// Diversi valori avevano un default comodo in sviluppo e pericoloso altrove: il segreto dei
// token era `'grip-dev-secret-change-me'`, il CORS accettava qualunque origine, la password
// del primo account era `admin1234`. Su un portatile non cambia nulla; su una macchina
// raggiungibile dalla rete, un segreto noto significa che chiunque può firmarsi un token da
// amministratore.
//
// Il criterio è che in sviluppo l'applicazione parte senza configurare niente, e fuori dallo
// sviluppo **si rifiuta di partire** finché le cose serie non sono state impostate. Un
// avviso nei log non basta: nessuno lo legge, e l'applicazione resterebbe in piedi insicura.

const SVILUPPO = (process.env.NODE_ENV || 'development') !== 'production';

const SEGRETO_DI_SVILUPPO = 'grip-dev-secret-change-me';

const mancanti = [];

function obbligatorio(nome, valoreDiSviluppo, spiegazione) {
	const valore = process.env[nome];
	if (valore) return valore;
	if (SVILUPPO) return valoreDiSviluppo;
	mancanti.push(`${nome} — ${spiegazione}`);
	return undefined;
}

export const config = {
	sviluppo: SVILUPPO,

	databaseUrl: process.env.DATABASE_URL,

	porta: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,

	jwtSecret: obbligatorio(
		'JWT_SECRET',
		SEGRETO_DI_SVILUPPO,
		'con un segreto noto chiunque può firmarsi un token da amministratore',
	),

	jwtScadenza: process.env.JWT_EXPIRES_IN || '12h',
	// I soci hanno una sessione più lunga, e non è una concessione: il gestionale lo si apre
	// al lavoro, davanti a una tastiera, e rifare l'accesso ogni mattina è normale. Il portale
	// lo si apre in palestra, col telefono in mano, spesso per mostrare un codice al tornello:
	// una sessione che scade ogni dodici ore vorrebbe dire digitare la password sotto il
	// bilanciere. Trenta giorni sono sostenibili **perché** una sessione ora si può revocare
	// (vedi `token_version` in db/schema/hr.js); senza quello sarebbero stati un rischio.
	jwtScadenzaSocio: process.env.MEMBER_JWT_EXPIRES_IN || '30d',

	/**
	 * La chiave con cui si firma il codice d'accesso che cambia ogni minuto.
	 *
	 * Deve restare sul server: è ciò che impedisce di ricavare i codici futuri da uno
	 * screenshot. Se non è impostata si usa quella dei token — non è l'ideale tenerne una
	 * sola per due usi, ma è infinitamente meglio di una derivazione senza chiave, ed
	 * evita che un'installazione già in piedi smetta di far entrare i soci al primo
	 * aggiornamento.
	 */
	qrSecret: process.env.QR_SECRET || undefined,

	/**
	 * La prima serratura delle comunicazioni (lib/invii.js): senza `INVII_REALI=true` nessun
	 * messaggio esce davvero, comunque sia configurata la palestra. Si usa il fornitore finto e il
	 * messaggio resta `simulato`. È spenta se manca: dimenticarla non deve mai far partire niente.
	 */
	inviiReali: ['1', 'true', 'si', 'sì'].includes(String(process.env.INVII_REALI ?? '').trim().toLowerCase()),

	/**
	 * La chiave con cui si cifrano le credenziali dei canali (lib/segreti.js): la password della
	 * casella, la chiave di Brevo. Facoltativa: senza, le credenziali non si possono salvare e i
	 * canali che le chiedono restano non configurati. Non blocca l'avvio, perché il primo deploy
	 * delle comunicazioni deve partire spento senza chiedere niente.
	 */
	chiaveSegreti: process.env.CHIAVE_SEGRETI || undefined,

	/**
	 * Origini ammesse dal browser. In sviluppo qualunque, perché Vite e il server girano su
	 * porte diverse e l'unico a raggiungerli è chi sta davanti al computer.
	 */
	origineConsentita: (() => {
		const dichiarate = process.env.CORS_ORIGIN;
		if (dichiarate) return dichiarate.split(',').map((o) => o.trim()).filter(Boolean);
		if (SVILUPPO) return true;
		mancanti.push('CORS_ORIGIN — senza, il backend accetterebbe richieste da qualunque sito');
		return [];
	})(),

	publicBaseUrl: process.env.PUBLIC_BASE_URL,

	/**
	 * Dove finiscono i file caricati (ricevute, fatture, logo).
	 *
	 * In locale è `server/uploads/`. In produzione **deve** puntare a un disco che
	 * sopravvive al deploy: su una piattaforma a container il filesystem si azzera a ogni
	 * rilascio, e le ricevute già emesse sparirebbero senza che nessuno se ne accorga
	 * finché qualcuno non prova ad aprirne una.
	 */
	uploadDir: process.env.UPLOAD_DIR || null,

	/**
	 * L'intestazione da cui leggere l'IP di chi si collega, se il server sta dietro un proxy.
	 *
	 * Su Railway ogni richiesta passa dal suo edge, e l'indirizzo che il server vede è quello del
	 * proxy: tutti i client sembrerebbero la stessa persona, e un limite ai tentativi di accesso
	 * per IP bloccherebbe l'intera palestra al primo che sbaglia. L'edge scrive l'IP vero in
	 * `X-Real-IP`. Fuori da un proxy l'intestazione la sceglierebbe il client, quindi si legge
	 * solo quando è dichiarata: in produzione `x-real-ip`, in sviluppo nessuna.
	 */
	intestazioneIp: (process.env.CLIENT_IP_HEADER ?? (SVILUPPO ? '' : 'x-real-ip')).toLowerCase() || null,
};

/**
 * Da chiamare all'avvio. Interrompe se manca qualcosa che fuori dallo sviluppo è
 * indispensabile, elencando cosa e perché.
 */
export function verificaConfigurazione() {
	if (!config.databaseUrl) {
		mancanti.unshift('DATABASE_URL — senza, il server non sa a quale database collegarsi');
	}
	if (mancanti.length === 0) return;

	throw new Error(
		`Configurazione incompleta (NODE_ENV=${process.env.NODE_ENV}). Mancano:\n` +
		mancanti.map((m) => `  · ${m}`).join('\n') +
		'\nImpostale nelle variabili d\'ambiente prima di avviare.',
	);
}

/** Se il segreto in uso è quello di sviluppo: serve a segnalarlo dove conta. */
export function segretoDiSviluppoInUso() {
	return config.jwtSecret === SEGRETO_DI_SVILUPPO;
}
