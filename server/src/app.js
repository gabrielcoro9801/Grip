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
import journalEntryRoutes from './routes/journalEntries.js';
import purchaseOrderRoutes from './routes/purchaseOrders.js';
import invoiceRoutes from './routes/invoices.js';
import exerciseClosureRoutes from './routes/exerciseClosures.js';
import payrollRoutes from './routes/payroll.js';
import receiptRoutes from './routes/receipts.js';
import organizationRoutes from './routes/organizations.js';
import ruoliRoutes from './routes/ruoli.js';
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
	//
	// `content-disposition` va dichiarato esplicitamente: il browser non lo espone al
	// JavaScript di un'altra origine se non lo si elenca, e senza di esso il file della
	// fattura elettronica verrebbe salvato con un nome inventato dal client invece che con
	// quello previsto dallo SdI — che ci tiene, perché due file omonimi vengono scartati
	// come duplicati.
	app.register(cors, { origin: config.origineConsentita, exposedHeaders: ['content-disposition'] });
	app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
	app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' });

	app.register(authRoutes);
	app.register(journalEntryRoutes);
	app.register(purchaseOrderRoutes);
	app.register(invoiceRoutes);
	app.register(exerciseClosureRoutes);
	app.register(payrollRoutes);
	app.register(receiptRoutes);
	app.register(organizationRoutes);
	app.register(ruoliRoutes);
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
		app.register(fastifyStatic, {
			root: DIST_DIR,
			prefix: '/',
			// Lo static è già registrato per gli upload: senza questo, il secondo tentativo
			// di aggiungere `reply.sendFile` fallisce e il server non parte.
			decorateReply: false,
		});

		// Le rotte dell'applicazione (/crm, /movimenti, /member-portal…) esistono solo nel
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
