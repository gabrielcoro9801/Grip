import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import entityRoutes from './routes/entities.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import organizationRoutes from './routes/organizations.js';
import ruoliRoutes from './routes/ruoli.js';
import qrRoutes from './routes/qr.js';
import prenotazioniRoutes from './routes/prenotazioni.js';
import { ENTITY_NAMES } from './entities/registry.js';
import { config } from './config.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOAD_DIR = config.uploadDir || path.join(serverRoot, 'uploads');
// Il frontend compilato: sta nella radice del repository, un livello sopra server/.
const DIST_DIR = path.resolve(serverRoot, '..', 'dist');

export function buildApp({ publicBaseUrl = 'http://localhost:3001', logger = true } = {}) {
	const app = Fastify({ logger });

	// In sviluppo il frontend Vite e questo backend girano su porte diverse: CORS
	// aperto è accettabile solo in locale, da restringere prima di qualunque deploy.
	app.register(cors, { origin: config.origineConsentita });
	app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
	// I file caricati sono serviti dallo stesso indirizzo dell'applicazione, quindi qualsiasi
	// cosa il browser accetti di eseguire da lì gira sul nostro dominio. L'estensione la
	// decide già il server (routes/uploads.js), ma queste due intestazioni sono la rete
	// sotto: `nosniff` impedisce al browser di indovinare un tipo diverso da quello
	// dichiarato, e una CSP che non concede nulla toglie a un documento servito da qui la
	// possibilità di eseguire script o chiamare altri indirizzi.
	//
	// `decorateReply: false`: `reply.sendFile` deve appartenere allo static del frontend, non
	// a questo. Le intestazioni qui sopra vivono nella chiusura del plugin che le registra, non
	// nella cartella: se fosse questo a decorare `sendFile`, anche l'index.html mandato al
	// router (più sotto) uscirebbe con la CSP degli upload, e la pagina resterebbe nera.
	app.register(fastifyStatic, {
		root: UPLOAD_DIR,
		prefix: '/uploads/',
		decorateReply: false,
		setHeaders(res) {
			res.setHeader('X-Content-Type-Options', 'nosniff');
			res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
		},
	});

	app.register(authRoutes);
	app.register(organizationRoutes);
	app.register(ruoliRoutes);
	app.register(qrRoutes);
	app.register(prenotazioniRoutes);
	app.register(entityRoutes);
	app.register(uploadRoutes, { uploadDir: UPLOAD_DIR, publicBaseUrl });

	app.get('/health', async () => ({ ok: true, entities: ENTITY_NAMES.length }));

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
		// automatica). I due casi sono opposti e vanno separati:
		//
		// index.html non si conserva. Non è pignoleria: quando il server risponde 304, il
		// browser tiene le intestazioni che aveva in memoria e aggiorna solo quelle presenti
		// nella risposta. Un'intestazione sbagliata mandata una volta — è successo con la CSP
		// degli upload — resta quindi appiccicata alla pagina a ogni ricaricamento, anche dopo
		// che il server ha smesso di mandarla, e l'unica via d'uscita per chi la subisce è
		// svuotare la cache a mano. `no-store` significa che non c'è nulla da conservare, e
		// quindi nulla che possa restare indietro. Il guscio pesa meno di due kilobyte.
		//
		// Tutto il resto in dist/ ha l'impronta del contenuto nel nome (index-B-iU0N-6.js): un
		// file con quel nome non cambierà mai, e index.html cita i nomi nuovi a ogni rilascio.
		app.register(fastifyStatic, {
			root: DIST_DIR,
			prefix: '/',
			cacheControl: false,
			setHeaders(res, percorsoFile) {
				const eIlGuscio = path.basename(percorsoFile) === 'index.html';
				res.setHeader('Cache-Control', eIlGuscio ? 'no-store' : 'public, max-age=31536000, immutable');
			},
		});

		// Le rotte dell'applicazione (/crm, /calendario, /member-portal…) esistono solo nel
		// browser: il router le gestisce dopo il caricamento. Chiedendole al server — con un
		// ricaricamento o un link condiviso — non corrispondono a nessun file, e senza questo
		// si otterrebbe un 404 su indirizzi che l'utente vede funzionare navigando.
		//
		// Si risponde con index.html e il router fa il resto. API e file caricati restano
		// fuori: lì un 404 è un 404, e mandare una pagina HTML a chi si aspetta JSON
		// produrrebbe un errore molto più difficile da capire.
		app.setNotFoundHandler((request, reply) => {
			const percorso = request.raw.url ?? '';
			const eRichiestaDiPagina = request.method === 'GET'
				&& !percorso.startsWith('/api/')
				&& !percorso.startsWith('/uploads/')
				&& !request.headers.accept?.includes('application/json');

			if (eRichiestaDiPagina) return reply.sendFile('index.html', DIST_DIR);
			return reply.code(404).send({ error: 'Non trovato' });
		});
	}

	return app;
}
