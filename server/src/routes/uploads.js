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
import { getUserFromRequest } from '../auth/tokens.js';

// Tipi ammessi, ognuno con l'estensione con cui viene salvato.
//
// L'estensione **non** si prende dal nome del file mandato dal client: il tipo veniva
// controllato qui, ma il nome memorizzato conservava l'estensione scelta da chi caricava.
// Bastava dichiarare `image/png` e chiamare il file `x.html` per farsi salvare una pagina
// HTML servita da /uploads/*, cioè dallo stesso indirizzo dell'applicazione: il codice
// dentro quella pagina poteva leggere il token di sessione dal localStorage e mandarlo
// altrove. L'estensione la decide questa tabella, e nient'altro.
//
// **SVG non è più ammesso.** È un documento XML che esegue script quando lo si apre
// direttamente, quindi come vettore vale quanto un file HTML; per un logo o la foto di un
// esercizio, PNG e WebP bastano.
const ESTENSIONE_PER_TIPO = {
	'application/pdf': '.pdf',
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp',
};

export default async function uploadRoutes(fastify, options) {
	const { uploadDir, publicBaseUrl } = options;

	// L'endpoint scrive file sul disco del server: senza autenticazione chiunque
	// raggiunga la porta può riempirlo, e i file caricati sono poi serviti pubblicamente
	// da /uploads/*. Caricano solo ricevute, fatture, allegati e logo: tutte cose dello
	// staff, quindi il portale soci non ha ragione di passare di qui.
	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (user.ruolo === 'member') {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di caricare file.' });
		}
	});

	fastify.post('/api/uploads', async (request, reply) => {
		const data = await request.file();
		if (!data) return reply.code(400).send({ error: 'Nessun file ricevuto.' });

		const ext = ESTENSIONE_PER_TIPO[data.mimetype];
		if (!ext) {
			return reply.code(400).send({ error: `Tipo di file non consentito: ${data.mimetype}` });
		}

		await mkdir(uploadDir, { recursive: true });

		// Nome ed estensione decisi dal server: un nome scelto dal client potrebbe contenere
		// path traversal, sovrascrivere file esistenti, o — con un'estensione eseguibile dal
		// browser — trasformare l'archivio in un punto da cui servire codice sul nostro
		// stesso dominio.
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
