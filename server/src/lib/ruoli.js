// Caricamento e salvataggio dei ruoli dell'ente.
//
// La matrice dei permessi viveva solo nel codice. Ora vive in banca dati, ma con due
// vincoli che restano nel codice e che nessuna riga salvata può scavalcare — il socio non
// riceve mai permessi da qui, e l'amministratore non perde mai la gestione degli utenti
// (vedi shared/permissions.js). Il limite si riapplica **in lettura**, non solo in
// scrittura: fidarsi di ciò che è già salvato significherebbe che una riga scritta a mano
// nel database aggira il controllo.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ruoli, organizations } from '../db/schema/index.js';
import {
	ROLES,
	PERMESSI_PREDEFINITI,
	CAPACITA_PREDEFINITE,
	impostaMatrice,
	ripristinaMatricePredefinita,
} from '../../../shared/permissions.js';

/** Crea i sei ruoli predefiniti per un ente che non ne ha ancora. Idempotente. */
export async function bootstrapRuoli(organizationId) {
	const esistenti = await db.select().from(ruoli).where(eq(ruoli.organizationId, organizationId));
	const presenti = new Set(esistenti.map((r) => r.nome));

	const daCreare = Object.entries(ROLES)
		.filter(([nome]) => !presenti.has(nome))
		.map(([nome, meta]) => ({
			organizationId,
			nome,
			label: meta.label,
			descrizione: meta.description,
			permessi: PERMESSI_PREDEFINITI[nome] ?? {},
			capacita: CAPACITA_PREDEFINITE[nome] ?? [],
			sistema: true,
		}));

	if (daCreare.length > 0) await db.insert(ruoli).values(daCreare);
	return daCreare.length;
}

/**
 * Legge i ruoli dell'ente e li rende la matrice in uso.
 *
 * Se non c'è nulla di salvato restano i valori predefiniti: un'installazione a cui non è
 * ancora stato fatto il bootstrap deve funzionare, non bloccarsi.
 */
export async function caricaMatrice(organizationId) {
	const righe = await db.select().from(ruoli).where(eq(ruoli.organizationId, organizationId));
	if (righe.length === 0) return ripristinaMatricePredefinita();

	const permessi = {};
	const capacita = {};
	for (const r of righe) {
		permessi[r.nome] = r.permessi ?? {};
		capacita[r.nome] = Array.isArray(r.capacita) ? r.capacita : [];
	}
	return impostaMatrice({ permessi, capacita });
}

/**
 * Carica la matrice dell'unica organizzazione presente.
 * All'avvio del server non c'è una richiesta da cui ricavarla, e l'installazione ne serve
 * una sola.
 */
export async function caricaMatriceIniziale() {
	const [ente] = await db.select().from(organizations).limit(1);
	if (!ente) return ripristinaMatricePredefinita();
	return caricaMatrice(ente.id);
}
