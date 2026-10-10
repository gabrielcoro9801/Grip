// Le credenziali dei canali, cifrate. Si scrivono e si usano per spedire; non si rileggono mai
// verso il browser: l'API dice solo se ci sono.
//
// AES-256-GCM: cifra e autentica, quindi un valore manomesso nel database non si decifra in
// qualcos'altro, si rifiuta. La chiave viene da CHIAVE_SEGRETI (qualunque testo lungo: se ne
// ricava una chiave da 256 bit con SHA-256). Il formato salvato porta la versione davanti, così
// un domani si può cambiare algoritmo o chiave senza indovinare come era scritto un valore.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { segretiCanali } from '../db/schema/index.js';
import { config } from '../config.js';

const VERSIONE = 'v1';

const chiave = (testo = config.chiaveSegreti) => createHash('sha256').update(String(testo)).digest();

/** Se le credenziali si possono salvare: serve CHIAVE_SEGRETI. */
export const cifraturaDisponibile = () => Boolean(config.chiaveSegreti);

export function cifra(valore, testoChiave = config.chiaveSegreti) {
	if (!testoChiave) throw new Error('CHIAVE_SEGRETI non impostata: le credenziali non si possono salvare.');
	const iv = randomBytes(12);
	const cifrario = createCipheriv('aes-256-gcm', chiave(testoChiave), iv);
	const dati = Buffer.concat([cifrario.update(String(valore), 'utf8'), cifrario.final()]);
	return [VERSIONE, iv.toString('base64'), cifrario.getAuthTag().toString('base64'), dati.toString('base64')].join(':');
}

export function decifra(salvato, testoChiave = config.chiaveSegreti) {
	const [versione, iv, tag, dati] = String(salvato).split(':');
	if (versione !== VERSIONE || !testoChiave) throw new Error('Credenziale non leggibile.');
	const decifrario = createDecipheriv('aes-256-gcm', chiave(testoChiave), Buffer.from(iv, 'base64'));
	decifrario.setAuthTag(Buffer.from(tag, 'base64'));
	return Buffer.concat([decifrario.update(Buffer.from(dati, 'base64')), decifrario.final()]).toString('utf8');
}

/** Salva (o sostituisce) la credenziale di un canale. */
export async function salvaSegreto(organizationId, canale, valore, conn = db) {
	const cifrato = cifra(valore);
	await conn.insert(segretiCanali).values({ organizationId, canale, cifrato, updatedDate: new Date() })
		.onConflictDoUpdate({ target: [segretiCanali.organizationId, segretiCanali.canale], set: { cifrato, updatedDate: new Date() } });
}

export async function cancellaSegreto(organizationId, canale, conn = db) {
	await conn.delete(segretiCanali).where(and(eq(segretiCanali.organizationId, organizationId), eq(segretiCanali.canale, canale)));
}

/** Per ogni canale: { impostato, aggiornato } — mai il valore. */
export async function statoSegreti(organizationId, conn = db) {
	const righe = await conn.select({ canale: segretiCanali.canale, aggiornato: segretiCanali.updatedDate })
		.from(segretiCanali).where(eq(segretiCanali.organizationId, organizationId));
	return Object.fromEntries(righe.map((r) => [r.canale, { impostato: true, aggiornato: new Date(r.aggiornato).toISOString() }]));
}

/** Il valore in chiaro, solo per spedire. null se non c'è o non si decifra. */
export async function leggiSegreto(organizationId, canale, conn = db) {
	const [riga] = await conn.select({ cifrato: segretiCanali.cifrato }).from(segretiCanali)
		.where(and(eq(segretiCanali.organizationId, organizationId), eq(segretiCanali.canale, canale))).limit(1);
	if (!riga) return null;
	try { return decifra(riga.cifrato); } catch { return null; }
}
