// Configurazione dei ruoli dell'ente.
//
// Chi ha in mano questa schermata decide chi può fare cosa: è la superficie più delicata
// dell'applicazione dopo l'autenticazione stessa. Da qui i tre controlli:
//
//  1. serve il permesso di gestione utenti — non basta essere autenticati;
//  2. non si può concedere a un ruolo un permesso che non si possiede (altrimenti chiunque
//     amministri gli utenti potrebbe promuoversi a qualsiasi cosa, e la delega di questa
//     schermata diventerebbe una delega di tutto);
//  3. il limite invalicabile viene comunque riapplicato al salvataggio.
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ruoli, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import {
	MODULES, CAPACITA, NOMI_CAPACITA,
	canAccess, puo, applicaLimiti, matriceCorrente,
} from '../../../shared/permissions.js';
import { caricaMatrice } from '../lib/ruoli.js';
import { registerPgErrorHandler } from './errorHandler.js';

const AZIONI = ['view', 'edit'];

/**
 * Il nome tecnico di un ruolo, ricavato dall'etichetta.
 *
 * Finisce nel token e nella colonna `ruolo` degli account, quindi **non cambia più**: se si
 * potesse rinominare, i token già emessi porterebbero un ruolo inesistente e chi li ha
 * resterebbe senza permessi fino alla scadenza. L'etichetta invece resta modificabile,
 * perché è solo quello che si legge.
 */
function nomeTecnico(label) {
	return String(label ?? '')
		.normalize('NFD').replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 32);
}

/**
 * Verifica che chi salva possieda tutto ciò che sta concedendo.
 *
 * Senza, delegare la gestione utenti equivarrebbe a delegare ogni altro permesso: chi la
 * riceve potrebbe creare un ruolo con quello che vuole e poi assegnarselo.
 * @returns {string|null} il messaggio d'errore, o null se va bene
 */
function eccessiDi(chiSalva, permessi, capacita) {
	const eccessi = [];
	for (const [modulo, azioni] of Object.entries(permessi ?? {})) {
		if (!MODULES[modulo]) return `Modulo sconosciuto: ${modulo}`;
		for (const azione of azioni ?? []) {
			if (!AZIONI.includes(azione)) return `Azione sconosciuta: ${azione}`;
			if (!canAccess(chiSalva, modulo, azione)) eccessi.push(`${MODULES[modulo].label} (${azione})`);
		}
	}
	for (const c of capacita ?? []) {
		if (!NOMI_CAPACITA.includes(c)) return `Capacità sconosciuta: ${c}`;
		if (!puo(chiSalva, c)) eccessi.push(CAPACITA[c].label);
	}
	if (eccessi.length > 0) {
		return `Non puoi concedere permessi che tu stesso non hai: ${[...new Set(eccessi)].join(', ')}.`;
	}
	return null;
}

export default async function ruoliRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (!canAccess(user.ruolo, 'admin_users', 'edit')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di configurare i permessi.' });
		}
		request.currentUser = user;
	});

	// GET /api/ruoli — i ruoli dell'ente, con il catalogo di moduli e capacità.
	fastify.get('/api/ruoli', async (request) => {
		const righe = await db
			.select()
			.from(ruoli)
			.where(eq(ruoli.organizationId, request.query.organization_id));
		return {
			ruoli: righe.map((r) => ({
				id: r.id, nome: r.nome, label: r.label, descrizione: r.descrizione,
				permessi: r.permessi, capacita: r.capacita, sistema: r.sistema,
			})),
			moduli: MODULES,
			capacita: CAPACITA,
		};
	});

	// POST /api/ruoli  { organization_id, label, descrizione, permessi, capacita }
	fastify.post('/api/ruoli', async (request, reply) => {
		const { organization_id: organizationId, label, descrizione, permessi = {}, capacita = [] } = request.body ?? {};
		if (!organizationId) return reply.code(400).send({ error: 'Indicare l\'organizzazione.' });
		if (!label?.trim()) return reply.code(400).send({ error: 'Indicare il nome del ruolo.' });

		const nome = nomeTecnico(label);
		if (!nome) {
			return reply.code(400).send({ error: 'Il nome del ruolo deve contenere almeno una lettera o una cifra.' });
		}

		const [collisione] = await db
			.select()
			.from(ruoli)
			.where(and(eq(ruoli.organizationId, organizationId), eq(ruoli.nome, nome)))
			.limit(1);
		if (collisione) {
			return reply.code(400).send({ error: `Esiste già un ruolo «${collisione.label}»: scegli un nome diverso.` });
		}

		// Lo stesso controllo del salvataggio: senza, si potrebbe creare un ruolo con
		// permessi che non si hanno e poi assegnarselo.
		const errore = eccessiDi(request.currentUser.ruolo, permessi, capacita);
		if (errore) return reply.code(403).send({ error: errore });

		const limitata = applicaLimiti({ permessi: { [nome]: permessi }, capacita: { [nome]: capacita } });

		const [creato] = await db
			.insert(ruoli)
			.values({
				organizationId,
				nome,
				label: label.trim(),
				descrizione: descrizione ?? null,
				permessi: limitata.permessi[nome] ?? {},
				capacita: limitata.capacita[nome] ?? [],
				sistema: false,
			})
			.returning();

		await caricaMatrice(organizationId);
		reply.code(201);
		return { ruolo: creato, matrice: matriceCorrente() };
	});

	// DELETE /api/ruoli/:id
	fastify.delete('/api/ruoli/:id', async (request, reply) => {
		const [ruolo] = await db.select().from(ruoli).where(eq(ruoli.id, request.params.id)).limit(1);
		if (!ruolo) return reply.code(404).send({ error: 'Ruolo non trovato.' });

		// I sei ruoli con cui l'applicazione nasce restano: il codice vi fa riferimento come
		// valori predefiniti, e toglierli lascerebbe l'installazione in uno stato che nessuna
		// schermata sa più ricostruire.
		if (ruolo.sistema) {
			return reply.code(400).send({
				error: `«${ruolo.label}» è uno dei ruoli di base e non si elimina. Puoi però cambiarne i permessi.`,
			});
		}

		// Un account con un ruolo inesistente non avrebbe più alcun permesso, e chi lo usa
		// se ne accorgerebbe trovando l'applicazione vuota senza capire perché.
		const assegnati = await db.select({ id: staffAccounts.id }).from(staffAccounts).where(eq(staffAccounts.ruolo, ruolo.nome));
		if (assegnati.length > 0) {
			return reply.code(400).send({
				error: `«${ruolo.label}» è assegnato a ${assegnati.length} ${assegnati.length === 1 ? 'account' : 'account'}: spostali su un altro ruolo prima di eliminarlo.`,
				account_collegati: assegnati.length,
			});
		}

		await db.delete(ruoli).where(eq(ruoli.id, ruolo.id));
		await caricaMatrice(ruolo.organizationId);
		return { success: true };
	});

	// PUT /api/ruoli/:id  { label, descrizione, permessi, capacita }
	fastify.put('/api/ruoli/:id', async (request, reply) => {
		const [ruolo] = await db.select().from(ruoli).where(eq(ruoli.id, request.params.id)).limit(1);
		if (!ruolo) return reply.code(404).send({ error: 'Ruolo non trovato.' });

		const { label, descrizione, permessi = {}, capacita = [] } = request.body ?? {};

		// Nessuno può concedere ciò che non ha. Senza questo, delegare la gestione utenti
		// equivarrebbe a delegare ogni altro permesso, perché chi la riceve potrebbe
		// assegnarsi tutto il resto.
		const errore = eccessiDi(request.currentUser.ruolo, permessi, capacita);
		if (errore) {
			// Un nome inventato è un errore nella richiesta; un permesso in eccesso è un divieto.
			return reply.code(/sconosciut/i.test(errore) ? 400 : 403).send({ error: errore });
		}

		// Il limite si applica prima di scrivere, così in banca dati non finisce nulla che
		// poi andrebbe filtrato in lettura.
		const limitata = applicaLimiti({ permessi: { [ruolo.nome]: permessi }, capacita: { [ruolo.nome]: capacita } });

		const [aggiornato] = await db
			.update(ruoli)
			.set({
				label: label ?? ruolo.label,
				descrizione: descrizione ?? ruolo.descrizione,
				permessi: limitata.permessi[ruolo.nome] ?? {},
				capacita: limitata.capacita[ruolo.nome] ?? [],
			})
			.where(eq(ruoli.id, ruolo.id))
			.returning();

		// La matrice in uso va aggiornata subito: fino al prossimo riavvio i controlli
		// risponderebbero altrimenti secondo la configurazione precedente.
		await caricaMatrice(ruolo.organizationId);

		return {
			ruolo: {
				id: aggiornato.id, nome: aggiornato.nome, label: aggiornato.label,
				descrizione: aggiornato.descrizione, permessi: aggiornato.permessi,
				capacita: aggiornato.capacita, sistema: aggiornato.sistema,
			},
			// Restituita perché il salvataggio può aver cambiato i permessi di chi sta
			// guardando: l'interfaccia deve poterli riapplicare senza ricaricare.
			matrice: matriceCorrente(),
		};
	});
}
