import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import { db } from './db/client.js';
import entityRoutes from './routes/entities.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import organizationRoutes from './routes/organizations.js';
import ruoliRoutes from './routes/ruoli.js';
import qrRoutes from './routes/qr.js';
import prenotazioniRoutes from './routes/prenotazioni.js';
import leadRoutes from './routes/lead.js';
import sociRoutes from './routes/soci.js';
import saleRoutes from './routes/sale.js';
import calendarioRoutes from './routes/calendario.js';
import dashboardRoutes from './routes/dashboard.js';
import memberRoutes from './routes/member/index.js';
import { firmaValida } from './lib/urlFirmati.js';
import { UPLOAD_DIR } from './lib/fileCaricati.js';
import { getUserFromRequest } from './auth/tokens.js';
import { statoSessione } from './auth/revoca.js';
import { ENTITY_NAMES } from './entities/registry.js';
import { config } from './config.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Il frontend compilato: sta nella radice del repository, un livello sopra server/.
const DIST_DIR = path.resolve(serverRoot, '..', 'dist');

// Le sole rotte aperte a chi deve ancora cambiare una password scelta da altri: sapere chi è,
// cambiarla, uscire.
const CONSENTITE_CON_PASSWORD_DA_CAMBIARE = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

// Quanto il controllo di salute aspetta il database prima di dirlo irraggiungibile.
const ATTESA_DATABASE_MS = 2000;

export function buildApp({ publicBaseUrl = 'http://localhost:3001', logger = true } = {}) {
	const app = Fastify({ logger });

	// In sviluppo il frontend Vite e questo backend girano su porte diverse: CORS
	// aperto è accettabile solo in locale, da restringere prima di qualunque deploy.
	app.register(cors, { origin: config.origineConsentita });

	// Le intestazioni di sicurezza delle pagine. Gli upload avevano già una CSP severa, le
	// pagine dell'applicazione nessuna: si potevano incorniciare in un altro sito, e il token di
	// sessione sta nel localStorage, dove qualunque script iniettato lo legge. La CSP è la rete
	// che limita i danni di un'iniezione: script solo dal nostro dominio, niente script scritti
	// nella pagina (il tema sta in public/tema.js apposta), nessuna chiamata verso altri siti.
	//
	// `style-src 'unsafe-inline'` resta: i componenti dell'interfaccia (Radix) posizionano menu
	// e finestre con attributi `style`, e senza si aprirebbero nel posto sbagliato. Uno stile
	// iniettato non legge token.
	//
	// Gli upload conservano la loro CSP più severa: la loro `setHeaders` la sovrascrive.
	app.register(helmet, {
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'", "'unsafe-inline'"],
				imgSrc: ["'self'", 'data:', 'blob:'],
				fontSrc: ["'self'", 'data:'],
				connectSrc: ["'self'"],
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'none'"],
			},
		},
		referrerPolicy: { policy: 'same-origin' },
		// Railway serve solo in HTTPS: il browser non deve mai provare la versione in chiaro.
		strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
	});
	app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
	// I file caricati non si servono più a chiunque conosca l'indirizzo.
	//
	// Il nome è casuale e quindi non si indovina, ma un indirizzo si condivide, finisce in
	// una cronologia, nel log di un proxy, in uno screenshot — e fra questi file ci sono i
	// certificati medici dei soci, cioè dati sanitari. "Difficile da indovinare" non è un
	// controllo d'accesso.
	//
	// Il controllo è una firma nell'indirizzo (`lib/urlFirmati.js`) e non il token di
	// sessione, perché un file non si chiede con `fetch`: sta in un `<img src>` o in un
	// `<a href>`, e quelle richieste il browser le manda senza nessuna intestazione nostra.
	//
	// A chi non ha la firma si risponde 404 e non 403: di un file che non può vedere non gli
	// si conferma nemmeno l'esistenza.
	//
	// **Il controllo sta dentro il contesto che serve i file, e legge il nome dalla rotta.**
	// Prima era un hook globale che confrontava il testo grezzo dell'indirizzo con
	// `/uploads/`: ma il router decodifica l'indirizzo prima di scegliere la rotta, e
	// `/%75ploads/x.pdf` (`%75` è la `u`) non superava il confronto e arrivava lo stesso ai
	// file, senza firma. Qui invece il hook vale per tutte le richieste che il router manda
	// allo static, comunque sia scritto l'indirizzo, e il nome è quello che il router ha
	// capito, già decodificato.
	//
	// Le due intestazioni sono la seconda difesa, e resta necessaria: la firma dice *chi* può
	// aprire il file, queste dicono cosa quel file può fare una volta aperto. `nosniff`
	// impedisce al browser di indovinare un tipo diverso da quello dichiarato, e una CSP che
	// non concede nulla toglie a un documento servito da qui la possibilità di eseguire script
	// o di chiamare altri indirizzi — cioè di comportarsi da pagina del nostro dominio.
	//
	// `decorateReply: false`: `reply.sendFile` deve appartenere allo static del frontend, non
	// a questo. Le intestazioni vivono nella chiusura del plugin che le registra, non nella
	// cartella: se fosse questo a decorare `sendFile`, anche l'index.html mandato al router
	// (più sotto) uscirebbe con la CSP degli upload, e la pagina resterebbe nera.
	app.register(async function fileCaricati(istanza) {
		istanza.addHook('onRequest', async (request, reply) => {
			const nome = request.params?.['*'];
			// Un nome con una barra non è mai uno dei nostri: i file stanno tutti in una cartella sola.
			if (!nome || nome.includes('/') || nome.includes('\\')
				|| !firmaValida(nome, request.query?.scade, request.query?.firma)) {
				return reply.code(404).send({ error: 'Non trovato' });
			}
		});

		istanza.register(fastifyStatic, {
			root: UPLOAD_DIR,
			prefix: '/uploads/',
			decorateReply: false,
			// Da @fastify/static 10 riceve il `reply` di Fastify, non la risposta grezza di Node.
			setHeaders(reply) {
				reply.header('X-Content-Type-Options', 'nosniff');
				reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
			},
		});
	});

	// Una sessione revocata smette di valere subito, non alla scadenza del token.
	//
	// Il controllo sta qui, in un punto solo, e non dentro ogni gruppo di rotte: è una
	// garanzia di sicurezza, e le garanzie di sicurezza sparse in sette file diventano sei
	// garanzie e una dimenticanza. Costa una lettura per richiesta autenticata, che su un
	// gestionale di palestra non si vede — e in cambio "esci da tutti i dispositivi" esiste
	// davvero, che con le sessioni dei soci a trenta giorni serve.
	//
	// Le richieste senza token passano di qui senza toccare il database: a rifiutarle ci
	// pensano le rotte, ognuna con la sua regola.
	//
	// Nello stesso punto, e con la stessa lettura, sta l'obbligo di cambiare una password
	// scelta da qualcun altro: finché non la si cambia, l'API risponde solo a quello che serve
	// per cambiarla. Imporlo qui e non nella schermata vuol dire che non lo si aggira
	// chiamando l'API a mano con la password che la reception ha dettato.
	app.addHook('preHandler', async (request, reply) => {
		const claims = getUserFromRequest(request);
		if (!claims) return;
		const { revocata, passwordDaCambiare } = await statoSessione(claims);
		if (revocata) {
			return reply.code(401).send({ error: 'Sessione non più valida.' });
		}
		if (passwordDaCambiare && !CONSENTITE_CON_PASSWORD_DA_CAMBIARE.has(request.routeOptions?.url)) {
			return reply.code(403).send({ error: 'Prima di continuare devi cambiare la password.', code: 'password_da_cambiare' });
		}
	});

	app.register(authRoutes);
	app.register(organizationRoutes);
	app.register(ruoliRoutes);
	app.register(qrRoutes);
	app.register(prenotazioniRoutes);
	app.register(leadRoutes);
	app.register(sociRoutes);
	app.register(saleRoutes);
	app.register(calendarioRoutes);
	app.register(dashboardRoutes);
	// L'API del portale soci, sotto un prefisso suo e con una versione nel percorso: è il
	// contratto che un domani reggerà un'app installata, che non si aggiorna a comando.
	// Registrata prima delle rotte generiche perché è la più specifica.
	app.register(memberRoutes, { prefix: '/api/member/v1' });
	app.register(entityRoutes);
	app.register(uploadRoutes, { uploadDir: UPLOAD_DIR, publicBaseUrl });

	// Railway considera riuscito un rilascio solo se questa rotta risponde. Rispondeva sempre,
	// anche con il database irraggiungibile: un server che non può leggere né scrivere niente
	// risultava sano, e il rilascio andava a buon fine. Ora deve riuscire un `SELECT 1`, e in
	// fretta — un controllo di salute che aspetta trenta secondi non dice niente di utile.
	// Il motivo del guasto va nei log, non nella risposta: la rotta è aperta a chiunque.
	app.get('/health', async (request, reply) => {
		let timer;
		try {
			await Promise.race([
				db.execute(sql`select 1`),
				new Promise((_, rifiuta) => {
					timer = setTimeout(() => rifiuta(new Error('il database non ha risposto in tempo')), ATTESA_DATABASE_MS);
				}),
			]);
		} catch (err) {
			request.log.error(err, 'controllo di salute: database non raggiungibile');
			return reply.code(503).send({ ok: false, database: false });
		} finally {
			clearTimeout(timer);
		}
		return { ok: true, database: true, entities: ENTITY_NAMES.length };
	});

	// --- Il frontend, servito dallo stesso server -----------------------------------------
	//
	// Pagine e API vivono sullo stesso indirizzo. Costa un po' in prestazioni rispetto a una
	// CDN — irrilevante per un gestionale usato da qualche persona — e in cambio toglie di
	// mezzo una classe intera di problemi: niente CORS, perché non c'è nessuna chiamata fra
	// domini diversi, un solo dominio da configurare e un solo rilascio.
	//
	// In sviluppo la cartella non esiste (ci pensa Vite sulla 5173) e questo blocco si salta.
	if (existsSync(DIST_DIR)) {
		// La cache la decidiamo noi, file per file (`cacheControl: false` toglie di mezzo quella
		// automatica). I due casi sono opposti e vanno separati.
		//
		// **La regola è scritta al contrario di come verrebbe da scriverla, ed è voluto.** Dice
		// "solo i file con l'impronta nel nome si conservano; tutto il resto no", invece di
		// elencare i gusci da non conservare. La differenza si vede quando si aggiunge un file:
		// prima la condizione era `basename === 'index.html'`, e il giorno in cui è arrivato
		// `member.html` quel guscio sarebbe uscito con **un anno** di cache. Un guscio conservato
		// per un anno cita i nomi degli asset di oggi per sempre: dopo il rilascio successivo
		// quei file non esistono più, e la pagina resta bianca finché l'utente non svuota la
		// cache a mano — cosa che non farà, perché non sa di doverlo fare.
		//
		// Scritta così, un guscio nuovo nasce con la regola giusta senza che nessuno se ne
		// ricordi. La forma sbagliata era già costata una volta, con la CSP degli upload che
		// restava appiccicata alla pagina: quando il server risponde 304 il browser tiene le
		// intestazioni che aveva e aggiorna solo quelle presenti nella risposta, quindi un
		// errore mandato una volta non si può più ritirare. `no-store` significa che non c'è
		// nulla da conservare, e quindi nulla che possa restare indietro. I gusci pesano meno
		// di due kilobyte l'uno.
		const CARTELLA_ASSET = `${path.sep}assets${path.sep}`;
		app.register(fastifyStatic, {
			root: DIST_DIR,
			prefix: '/',
			cacheControl: false,
			setHeaders(reply, percorsoFile) {
				// Un file sotto assets/ ha l'impronta del contenuto nel nome (index-a6vVHwFR.js):
				// con quel nome non cambierà mai più, e i gusci citano i nomi nuovi a ogni rilascio.
				const eUnAsset = percorsoFile.includes(CARTELLA_ASSET);
				reply.header('Cache-Control', eUnAsset ? 'public, max-age=31536000, immutable' : 'no-store');
			},
		});

		// Le rotte dell'applicazione (/crm, /calendario, /member-portal…) esistono solo nel
		// browser: il router le gestisce dopo il caricamento. Chiedendole al server — con un
		// ricaricamento o un link condiviso — non corrispondono a nessun file, e senza questo
		// si otterrebbe un 404 su indirizzi che l'utente vede funzionare navigando.
		//
		// Si risponde con un guscio e il router fa il resto. **Quale** guscio lo dice
		// l'indirizzo: le applicazioni sono due, e mandare quello sbagliato significherebbe
		// caricare il gestionale a un socio, che poi non troverebbe nessuna rotta
		// corrispondente. Il confronto ignora le maiuscole perché il router fa lo stesso.
		//
		// API e file caricati restano fuori: lì un 404 è un 404, e mandare una pagina HTML a
		// chi si aspetta JSON produrrebbe un errore molto più difficile da capire.
		app.setNotFoundHandler((request, reply) => {
			const percorso = request.raw.url ?? '';
			const eRichiestaDiPagina = request.method === 'GET'
				&& !percorso.startsWith('/api/')
				&& !percorso.startsWith('/uploads/')
				&& !request.headers.accept?.includes('application/json');

			if (!eRichiestaDiPagina) return reply.code(404).send({ error: 'Non trovato' });

			const eIlPortale = percorso.toLowerCase().startsWith('/member-portal');
			return reply.sendFile(eIlPortale ? 'member.html' : 'index.html', DIST_DIR);
		});
	}

	return app;
}
