// Archiviazione file: riceve un file, lo salva e restituisce { file_url }. Lo chiama
// `caricaFile` (src/staff/lib/uploads.js): documenti e foto dei soci, immagini degli esercizi.
//
// In sviluppo i file finiscono su disco in server/uploads/ e vengono serviti da
// /uploads/*. Per la produzione qui andrà uno storage S3-compatible (R2/MinIO):
// cambia solo l'implementazione di questo handler, non i chiamanti.
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { getUserFromRequest } from '../auth/tokens.js';
import { cancellaFile } from '../lib/fileCaricati.js';

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

// Il tipo lo dichiara il client, e dichiarare non costa niente: un file HTML mandato come
// `application/pdf` veniva salvato come .pdf. `nosniff` e la CSP del sandbox gli impediscono
// già di comportarsi da pagina, ma resta un file che dice di essere un'altra cosa — e chi lo
// apre dalla scheda del socio si aspetta un certificato. I primi byte di ogni formato sono
// fissi: se non tornano, il file non è quello che dice di essere.
const FIRME = {
	'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
	'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
	'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Vera se i primi byte del file sul disco corrispondono al tipo dichiarato. */
async function contenutoDelTipo(percorso, tipo) {
	const file = await open(percorso, 'r');
	try {
		const inizio = Buffer.alloc(12);
		const { bytesRead } = await file.read(inizio, 0, inizio.length, 0);
		return FIRME[tipo](inizio.subarray(0, bytesRead));
	} finally {
		await file.close();
	}
}

export default async function uploadRoutes(fastify, options) {
	const { uploadDir, publicBaseUrl } = options;

	// L'endpoint scrive file sul disco del server: senza autenticazione chiunque
	// raggiunga la porta può riempirlo, e i file caricati sono poi serviti pubblicamente
	// da /uploads/*. Caricano documenti e foto dei soci e immagini degli esercizi: tutte cose dello
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

		try {
			await pipeline(data.file, createWriteStream(destination));
		} catch (err) {
			// Un caricamento interrotto lascerebbe un pezzo di file che nessuna riga cita.
			await cancellaFile(destination);
			throw err;
		}

		// @fastify/multipart segnala così il superamento del limite di dimensione: il file va
		// scartato, non lasciato a metà sul disco. Il commento lo diceva da tempo; ora lo fa.
		if (data.file.truncated) {
			await cancellaFile(destination);
			return reply.code(413).send({ error: 'File troppo grande.' });
		}

		if (!(await contenutoDelTipo(destination, data.mimetype))) {
			await cancellaFile(destination);
			return reply.code(400).send({ error: 'Il contenuto del file non corrisponde al suo tipo (PDF, PNG, JPEG, GIF o WebP).' });
		}

		return { file_url: `${publicBaseUrl}/uploads/${storedName}`, file_name: data.filename };
	});
}
