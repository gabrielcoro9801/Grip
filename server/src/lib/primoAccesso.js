// Il primo amministratore: l'account protetto. Email e password vengono dal file di configurazione
// del server (ADMIN_EMAIL, ADMIN_PASSWORD), e ad ogni avvio l'account si allinea a quel file. Chi
// le vuole cambiare lo fa lì, sul server: dall'applicazione non si cambiano, né si disattiva o si
// elimina l'account (hooks.js, routes/entities.js).
//
// Il problema che risolve: un'installazione appena messa online ha un database vuoto, e per creare
// un account bisogna essere autenticati. Il primo account nasce dall'interno, leggendo le variabili
// del servizio. Un cambio di email o di password chiude le sessioni aperte.
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { config } from '../config.js';
import { staffAccounts, organizations } from '../db/schema/index.js';
import { bootstrapRuoli } from './ruoli.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';

/** Un altro account (non quello protetto) con questa email: il primo amministratore non lo sovrascrive. */
async function emailDiAltri(email, idProtetto) {
	const [altro] = await db.select({ id: staffAccounts.id }).from(staffAccounts)
		.where(sql`lower(${staffAccounts.email}) = lower(${email}) AND (${idProtetto}::uuid IS NULL OR ${staffAccounts.id} <> ${idProtetto}::uuid)`)
		.limit(1);
	return Boolean(altro);
}

export async function creaAmministratoreIniziale(log) {
	const nonValida = motivoPasswordNonValida(config.adminPassword);
	if (nonValida) throw new Error(`ADMIN_PASSWORD non va bene: ${nonValida}`);

	// L'ente e i suoi ruoli servono comunque: senza non si sa a chi appartengono i dati né chi può fare cosa.
	const [enteEsistente] = await db.select().from(organizations).limit(1);
	const ente = enteEsistente ?? (await db
		.insert(organizations)
		.values({ nome: process.env.SEED_ORGANIZZAZIONE || 'La mia associazione' })
		.returning())[0];
	await bootstrapRuoli(ente.id);

	const [protetto] = await db.select().from(staffAccounts).where(eq(staffAccounts.protetto, true)).limit(1);

	if (!protetto) {
		if (await emailDiAltri(config.adminEmail, null)) {
			throw new Error(`ADMIN_EMAIL «${config.adminEmail}» è già di un altro account: cambia ADMIN_EMAIL, o togli quell'account dal database.`);
		}
		await db.insert(staffAccounts).values({
			nome: 'Amministratore',
			email: config.adminEmail,
			passwordHash: await bcrypt.hash(config.adminPassword, 10),
			ruolo: 'admin',
			attivo: true,
			protetto: true,
		});
		log?.info(`Primo amministratore creato: ${config.adminEmail} per «${ente.nome}».`);
		return { creato: true };
	}

	const cambiaEmail = protetto.email.toLowerCase() !== config.adminEmail.toLowerCase();
	const cambiaPassword = !(await bcrypt.compare(config.adminPassword, protetto.passwordHash));
	if (!cambiaEmail && !cambiaPassword) return { creato: false };
	if (cambiaEmail && (await emailDiAltri(config.adminEmail, protetto.id))) {
		throw new Error(`ADMIN_EMAIL «${config.adminEmail}» è già di un altro account: cambia ADMIN_EMAIL, o togli quell'account dal database.`);
	}
	await db.update(staffAccounts).set({
		email: config.adminEmail,
		ruolo: 'admin',
		attivo: true,
		...(cambiaPassword ? {
			passwordHash: await bcrypt.hash(config.adminPassword, 10),
			tokenVersion: sql`${staffAccounts.tokenVersion} + 1`,
		} : {}),
	}).where(eq(staffAccounts.id, protetto.id));
	log?.info(`Primo amministratore riallineato al file di configurazione${cambiaPassword ? ' (password cambiata: sessioni chiuse)' : ''}.`);
	return { creato: false, riallineato: true };
}
