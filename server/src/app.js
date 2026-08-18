import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import entityRoutes from './routes/entities.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import { ENTITY_NAMES } from './entities/registry.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOAD_DIR = path.join(serverRoot, 'uploads');

export function buildApp({ publicBaseUrl = 'http://localhost:3001' } = {}) {
	const app = Fastify({ logger: true });

	// In sviluppo il frontend Vite e questo backend girano su porte diverse: CORS
	// aperto è accettabile solo in locale, da restringere prima di qualunque deploy.
	app.register(cors, { origin: true });
	app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
	app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' });

	app.register(authRoutes);
	app.register(entityRoutes);
	app.register(uploadRoutes, { uploadDir: UPLOAD_DIR, publicBaseUrl });

	app.get('/health', async () => ({ ok: true, entities: ENTITY_NAMES.length }));

	return app;
}
