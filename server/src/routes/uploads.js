// Archiviazione file: riceve un file, lo salva e
// restituisce { file_url }, la stessa forma di risposta che i 4 call site esistenti
// (receiptEngine.js, ReceiptTemplatePage.jsx) già si aspettano.
//
// In sviluppo i file finiscono su disco in server/uploads/ e vengono serviti da
// /uploads/*. Per la produzione qui andrà uno storage S3-compatible (R2/MinIO):
// cambia solo l'implementazione di questo handler, non i chiamanti.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const ALLOWED_MIME = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/svg+xml',
]);

export default async function uploadRoutes(fastify, options) {
	const { uploadDir, publicBaseUrl } = options;

	fastify.post('/api/uploads', async (request, reply) => {
		const data = await request.file();
		if (!data) return reply.code(400).send({ error: 'Nessun file ricevuto.' });

		if (!ALLOWED_MIME.has(data.mimetype)) {
			return reply.code(400).send({ error: `Tipo di file non consentito: ${data.mimetype}` });
		}

		await mkdir(uploadDir, { recursive: true });

		// Nome generato lato server: un nome scelto dal client potrebbe contenere
		// path traversal o sovrascrivere file esistenti.
		const ext = path.extname(data.filename || '').slice(0, 10);
		const storedName = `${randomUUID()}${ext}`;
		const destination = path.join(uploadDir, storedName);

		await pipeline(data.file, createWriteStream(destination));

		// @fastify/multipart segnala così il superamento del limite di dimensione:
		// il file va scartato, non lasciato a metà sul disco.
		if (data.file.truncated) {
			return reply.code(413).send({ error: 'File troppo grande.' });
		}

		return { file_url: `${publicBaseUrl}/uploads/${storedName}`, file_name: data.filename };
	});
}
