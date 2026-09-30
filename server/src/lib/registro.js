// Il registro delle azioni, scritto dal server.
//
// Lo scriveva il browser: dopo ogni modifica una pagina chiamava `logAction`, che creava una
// riga con dentro attore, ruolo e orario **decisi dal client**. Qualunque ruolo poteva quindi
// scrivere voci attribuite a un altro, con l'ora che preferiva; un'azione fatta direttamente
// sull'API non lasciava nessuna traccia; e il registro conteneva solo quello che una pagina si
// ricordava di registrare — la creazione di sale, corsi, eventi e prenotazioni non c'era.
//
// Ora ogni scrittura riuscita dello staff passa di qui: chi l'ha fatta lo dice il token, il
// quando lo dice il database. I client il registro lo leggono e basta.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLogs, staffAccounts } from '../db/schema/index.js';

/** "StaffAccount" → "staff_account": la chiave del tipo di entità nel registro. */
export const tipoEntita = (nomeEntita) => nomeEntita.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Un nome leggibile per una riga, dai campi che la descrivono meglio. */
export function nomeLeggibile(riga) {
	if (!riga) return '';
	const persona = [riga.nome, riga.cognome].filter(Boolean).join(' ');
	return String(
		riga.full_name || riga.name || persona || riga.plan_name || riga.member_name || riga.titolo || riga.email || '',
	).slice(0, 255);
}

// I campi che non dicono niente a chi legge il registro, o che non devono finirci.
const CAMPI_TACIUTI = new Set(['updated_date', 'created_date', 'password', 'password_hash', 'token_version', 'password_da_cambiare']);

/**
 * Tipo d'azione e dettagli di una modifica, da com'era la riga e da cosa è arrivato.
 *
 * Password, ruolo e attivazione hanno un'azione loro, perché sono quelle che si cercano quando
 * qualcosa è andato storto. Per il ruolo si registrano anche il prima e il dopo; per il resto
 * solo quali campi sono cambiati — un registro non è un secondo archivio di dati personali.
 */
export function descriviModifica(prima, corpo) {
	const campi = Object.keys(corpo ?? {}).filter((c) => !CAMPI_TACIUTI.has(c));
	if (corpo?.password) return { tipoAzione: 'password_reset', dettagli: 'Password reimpostata' };
	if ('ruolo' in (corpo ?? {}) && prima && corpo.ruolo !== prima.ruolo) {
		return { tipoAzione: 'role_change', dettagli: 'Ruolo cambiato', valorePrecedente: prima.ruolo, valoreNuovo: corpo.ruolo };
	}
	if ('attivo' in (corpo ?? {}) && prima && corpo.attivo !== prima.attivo) {
		return { tipoAzione: corpo.attivo ? 'activate' : 'deactivate', dettagli: corpo.attivo ? 'Riattivato' : 'Disattivato' };
	}
	if ('stato' in (corpo ?? {}) && prima && corpo.stato !== prima.stato) {
		return { tipoAzione: 'update', dettagli: 'Stato cambiato', valorePrecedente: prima.stato, valoreNuovo: corpo.stato };
	}
	return { tipoAzione: 'update', dettagli: campi.length ? `Campi modificati: ${campi.join(', ')}` : '' };
}

/**
 * Scrive una voce. Non fa mai fallire l'operazione che registra: quella è già avvenuta, e
 * rifiutarla adesso non la disfarebbe. L'errore finisce nei log del server.
 *
 * @param utente i claims del token ({ sub, ruolo }).
 */
export async function registra(utente, { tipoAzione, entitaTipo, entitaNome = '', entitaId = '', dettagli = '', valorePrecedente = '', valoreNuovo = '' }, log) {
	if (!utente?.sub || utente.ruolo === 'member') return;
	try {
		const [attore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, utente.sub)).limit(1);
		await db.insert(auditLogs).values({
			attoreId: utente.sub,
			attoreNome: attore?.nome ?? '',
			ruoloAttore: utente.ruolo ?? '',
			tipoAzione,
			entitaTipo,
			entitaNome: String(entitaNome ?? '').slice(0, 255),
			entitaId: String(entitaId ?? ''),
			dettagli: String(dettagli ?? ''),
			valorePrecedente: String(valorePrecedente ?? ''),
			valoreNuovo: String(valoreNuovo ?? ''),
		});
	} catch (err) {
		log?.error?.({ err }, 'registro delle azioni: voce non scritta');
	}
}
