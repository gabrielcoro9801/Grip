// L'email, con il fornitore scelto dalla palestra (shared/comunicazioni.js, FORNITORI):
//
// - `smtp`: la casella della palestra. Il mittente è vero e non costa niente; i limiti sono
//   quelli della casella (qualche centinaio al giorno), più che sufficienti per i playbook.
// - `brevo`: un servizio di invio (API HTTPS). IP con buona reputazione, piano gratuito da 300 al
//   giorno; la palestra verifica il proprio dominio su Brevo perché il mittente sia credibile.
//
// Un server di posta nostro sugli IP di Railway non c'è apposta: finirebbe in spam.
//
// Questo file non decide *se* spedire: lo decide lib/invii.js, con le tre serrature. Qui si
// arriva solo con gli invii veri accesi e il canale pronto.
import nodemailer from 'nodemailer';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const ATTESA_MS = 15000;

/**
 * @param a.a             l'indirizzo del destinatario
 * @param a.conf          { fornitore, mittente, nome_mittente, host, porta, utente }
 * @param a.segreto       la password della casella o la chiave API
 * @param a.intestazioni  intestazioni in più (List-Unsubscribe per le promozioni)
 * @returns { idFornitore, costoCentesimi }
 */
export async function invia({ a, oggetto, testo, conf, segreto, intestazioni = {} }) {
	if (conf.fornitore === 'smtp') {
		const trasporto = nodemailer.createTransport({
			host: conf.host, port: Number(conf.porta), secure: Number(conf.porta) === 465,
			auth: { user: conf.utente, pass: segreto },
			connectionTimeout: ATTESA_MS, greetingTimeout: ATTESA_MS, socketTimeout: ATTESA_MS,
		});
		const esito = await trasporto.sendMail({
			from: { name: conf.nome_mittente, address: conf.mittente }, to: a, subject: oggetto, text: testo, headers: intestazioni,
		});
		return { idFornitore: esito.messageId ?? null, costoCentesimi: 0 };
	}
	if (conf.fornitore === 'brevo') {
		const risposta = await fetch(BREVO_URL, {
			method: 'POST',
			headers: { 'api-key': segreto, 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({
				sender: { email: conf.mittente, name: conf.nome_mittente }, to: [{ email: a }],
				subject: oggetto, textContent: testo, headers: Object.keys(intestazioni).length ? intestazioni : undefined,
			}),
			signal: AbortSignal.timeout(ATTESA_MS),
		});
		const corpo = await risposta.json().catch(() => ({}));
		if (!risposta.ok) throw new Error(`Brevo ha risposto ${risposta.status}: ${corpo.message ?? 'errore'}`);
		// ponytail: il piano gratuito di Brevo non costa; i piani a pagamento si pagano a pacchetto,
		// non a messaggio, quindi il costo per email resta 0 nel registro.
		return { idFornitore: corpo.messageId ?? null, costoCentesimi: 0 };
	}
	throw new Error(`Fornitore email sconosciuto: ${conf.fornitore}`);
}
