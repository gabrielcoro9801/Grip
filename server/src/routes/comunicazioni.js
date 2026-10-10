// La sezione Comunicazioni: canali, credenziali, playbook, testi, regole, l'interruttore generale e
// il registro dei messaggi. Solo chi ha il modulo `crm_comunicazioni` (di base l'amministratore):
// da qui si decide che cosa parte verso i soci, e con quale spesa.
//
// Ogni modifica passa dal registro delle azioni. Le credenziali entrano e non escono: la lettura
// dice solo se ci sono (lib/segreti.js).
import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { organizations, messaggi, modelliMessaggio, persone, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { config } from '../config.js';
import { contesto, componi, occasioniDelGiorno } from '../lib/invii.js';
import { salvaSegreto, cancellaSegreto, cifraturaDisponibile, leggiSegreto } from '../lib/segreti.js';
import { situazioni } from '../lib/segnali.js';
import * as finto from '../lib/canali/finto.js';
import * as email from '../lib/canali/email.js';
import {
	CANALI, FORNITORI, PLAYBOOK, playbook as playbookDi, fornitore as fornitoreDi, statoPlaybookValido, listaDiControllo,
	improntaCanale, scegliCanale, chiaveMessaggio, occasione, segnapostoSconosciuti, LIMITI_TESTO, SEGNAPOSTO, testoPer,
	emailValida, mittenteSmsValido, meseDi, etichettaCanale,
} from '../../../shared/comunicazioni.js';
import { SOGLIE, soglieDi } from '../../../shared/soglie.js';
import { normalizzaTelefono } from '../../../shared/anagrafica.js';

const MODULO = 'crm_comunicazioni';
const SCRITTURE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CODICE_VALIDO_MINUTI = 30;
const hash = (v) => createHash('sha256').update(String(v)).digest('hex');
const errore = (reply, codice, testo) => reply.code(codice).send({ error: testo });

/** Le impostazioni della palestra, con quella delle comunicazioni da scrivere. */
async function palestra(conn = db) {
	const [p] = await conn.select().from(organizations).limit(1);
	return p ?? null;
}

/** Cambia `impostazioni.comunicazioni` con una funzione, in una transazione con la riga bloccata. */
async function aggiorna(cambia) {
	return db.transaction(async (tx) => {
		const [p] = await tx.select().from(organizations).limit(1).for('update');
		const impostazioni = { ...(p.impostazioni ?? {}) };
		const com = structuredClone(impostazioni.comunicazioni ?? {});
		const esito = cambia(com, impostazioni);
		impostazioni.comunicazioni = com;
		await tx.update(organizations).set({ impostazioni }).where(eq(organizations.id, p.id));
		return esito;
	});
}

async function nomeDi(utente) {
	const [a] = await db.select({ nome: staffAccounts.nome, email: staffAccounts.email }).from(staffAccounts).where(eq(staffAccounts.id, utente.sub)).limit(1);
	return a ?? { nome: '', email: null };
}

/** La sezione intera, come la mostra la pagina: niente credenziali, solo se ci sono. */
async function vista() {
	const ctx = await contesto(db);
	const p = await palestra();
	const { com, statiCanali, segreti } = ctx;
	const lista = listaDiControllo({ statiCanali, informativa: com.informativa, testiRivisti: com.testi_rivisti });
	return {
		invii_reali: config.inviiReali,
		cifratura: cifraturaDisponibile(),
		attive: com.attive,
		silenzio: com.silenzio,
		budget_sms_centesimi: com.budget_sms_centesimi,
		costo_sms_centesimi: com.costo_sms_centesimi,
		spesa_sms_mese: ctx.spesiSms,
		canali: CANALI.map((c) => {
			const { verificato, prova, ...conf } = com.canali[c.valore] ?? {};
			return {
				canale: c.valore, etichetta: c.etichetta, stato: statiCanali[c.valore], conf,
				verificato: verificato ? { il: verificato.il, reale: verificato.reale, da: verificato.da } : null,
				prova_in_corso: Boolean(prova && prova.scade > Date.now()),
				segreto: segreti[c.valore] ?? { impostato: false },
				fornitori: FORNITORI[c.valore],
			};
		}),
		playbook: PLAYBOOK.map((pb) => ({
			codice: pb.codice, titolo: pb.titolo, tipo: pb.tipo, quando: pb.quando, immediato: Boolean(pb.immediato),
			canali: pb.canali, stato: com.playbook[pb.codice],
			testi: Object.fromEntries(pb.canali.map((c) => [c, testoPer(pb.codice, c, ctx.modelli)])),
		})),
		lista,
		informativa: com.informativa,
		testi_rivisti: com.testi_rivisti,
		soglie: soglieDi(p.impostazioni),
		segnaposto: SEGNAPOSTO,
		limiti: LIMITI_TESTO,
	};
}

export default async function comunicazioniRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return errore(reply, 401, 'Non autenticato.');
		// Il metodo, non l'indirizzo: una query string non trasforma una scrittura in una lettura.
		const azione = SCRITTURE.has(request.method) ? 'edit' : 'view';
		if (utente.ruolo === 'member' || !canAccess(utente.ruolo, MODULO, azione)) {
			return errore(reply, 403, 'Solo l\'amministratore gestisce le comunicazioni.');
		}
		request.utente = utente;
	});

	const traccia = (request, entitaNome, dettagli, extra = {}) => registra(request.utente, {
		tipoAzione: 'update', entitaTipo: 'comunicazioni', entitaNome, dettagli, ...extra,
	}, request.log);

	/** GET /api/comunicazioni → la sezione intera */
	fastify.get('/api/comunicazioni', async () => vista());

	/** PUT /api/comunicazioni/regole { silenzio: { dalle, alle }, budget_sms_centesimi, costo_sms_centesimi } */
	fastify.put('/api/comunicazioni/regole', async (request, reply) => {
		const { silenzio, budget_sms_centesimi: budget, costo_sms_centesimi: costo } = request.body ?? {};
		const ora = (v) => Number.isInteger(v) && v >= 0 && v <= 23;
		if (silenzio && (!ora(silenzio.dalle) || !ora(silenzio.alle))) return errore(reply, 400, 'La fascia di silenzio va da un\'ora intera a un\'altra (0–23).');
		const cent = (v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 10_000_000);
		if (!cent(budget) || !cent(costo)) return errore(reply, 400, 'Budget e costo degli SMS sono importi in centesimi, non negativi.');
		await aggiorna((com) => {
			if (silenzio) com.silenzio = { dalle: silenzio.dalle, alle: silenzio.alle };
			if (budget !== undefined) com.budget_sms_centesimi = budget;
			if (costo !== undefined) com.costo_sms_centesimi = costo;
		});
		await traccia(request, 'Regole', `Silenzio, budget o costo SMS cambiati`);
		return vista();
	});

	/**
	 * PUT /api/comunicazioni/soglie { segnali: { … }, abbonamentoInScadenzaGiorni, documentoInScadenzaGiorni, lead: { … } }
	 * Le soglie del motore (shared/soglie.js), per questa palestra. Si salvano solo chiavi note e
	 * valori sensati: una soglia sbagliata non deve svuotare né riempire le liste di lavoro.
	 */
	fastify.put('/api/comunicazioni/soglie', async (request, reply) => {
		const scelte = request.body ?? {};
		const valido = (v) => Number.isInteger(v) && v > 0 && v <= 3650;
		const pulisci = (predefinite, date) => Object.fromEntries(Object.entries(predefinite).flatMap(([k, v]) => {
			if (typeof v === 'object') return date?.[k] ? [[k, pulisci(v, date[k])]] : [];
			return valido(date?.[k]) ? [[k, date[k]]] : [];
		}));
		const sbagliate = [];
		const controlla = (predefinite, date, percorso) => Object.entries(date ?? {}).forEach(([k, v]) => {
			if (!(k in predefinite)) sbagliate.push(`${percorso}${k}`);
			else if (typeof predefinite[k] === 'object') controlla(predefinite[k], v, `${percorso}${k}.`);
			else if (!valido(v)) sbagliate.push(`${percorso}${k}`);
		});
		controlla(SOGLIE, scelte, '');
		if (sbagliate.length) return errore(reply, 400, `Soglie non valide: ${sbagliate.join(', ')} (numeri interi da 1 a 3650).`);
		await db.transaction(async (tx) => {
			const [p] = await tx.select().from(organizations).limit(1).for('update');
			const attuali = p.impostazioni?.soglie ?? {};
			const nuove = pulisci(SOGLIE, { ...attuali, ...scelte, segnali: { ...attuali.segnali, ...scelte.segnali }, lead: { ...attuali.lead, ...scelte.lead } });
			await tx.update(organizations).set({ impostazioni: { ...(p.impostazioni ?? {}), soglie: nuove } }).where(eq(organizations.id, p.id));
		});
		await traccia(request, 'Soglie', 'Soglie del motore dei segnali cambiate');
		return vista();
	});

	/**
	 * PUT /api/comunicazioni/canali/:canale { fornitore, mittente, nome_mittente, host, porta, utente, segreto?, cancella_segreto?, attivo? }
	 * La configurazione di un canale. Cambiarla rende di nuovo necessario l'invio di prova
	 * (l'impronta non corrisponde più). La credenziale si scrive e basta.
	 */
	fastify.put('/api/comunicazioni/canali/:canale', async (request, reply) => {
		const canale = request.params.canale;
		if (!CANALI.some((c) => c.valore === canale)) return errore(reply, 404, 'Canale sconosciuto.');
		const b = request.body ?? {};
		const p = await palestra();

		if (canale === 'app') {
			if (typeof b.attivo !== 'boolean') return errore(reply, 400, 'Indica se le notifiche nel portale sono attive.');
			await aggiorna((com) => { com.canali = { ...com.canali, app: { attivo: b.attivo } }; });
			await traccia(request, etichettaCanale('app'), b.attivo ? 'Canale attivato' : 'Canale disattivato');
			return vista();
		}

		const f = fornitoreDi(canale, b.fornitore);
		if (!f) return errore(reply, 400, 'Scegli il fornitore.');
		const conf = { fornitore: b.fornitore };
		for (const campo of f.campi) conf[campo] = typeof b[campo] === 'string' ? b[campo].trim() : b[campo];
		if (canale === 'email' && !emailValida(conf.mittente)) return errore(reply, 400, 'L\'indirizzo del mittente non è valido.');
		if (canale === 'email' && !conf.nome_mittente) return errore(reply, 400, 'Scrivi il nome del mittente (di solito quello della palestra).');
		if (canale === 'sms' && !mittenteSmsValido(conf.mittente)) return errore(reply, 400, 'Il mittente SMS va da 1 a 11 caratteri, lettere e cifre, con almeno una lettera.');
		if (f.campi.includes('host') && !/^[a-z0-9.-]+$/i.test(conf.host ?? '')) return errore(reply, 400, 'Il server SMTP non è valido (per esempio smtp.gmail.com).');
		if (f.campi.includes('porta')) {
			conf.porta = Number(conf.porta);
			if (![25, 465, 587, 2525].includes(conf.porta)) return errore(reply, 400, 'La porta SMTP è di solito 587 (o 465).');
		}
		if (f.campi.includes('utente') && !conf.utente) return errore(reply, 400, 'Scrivi l\'utente della casella (di solito l\'indirizzo email).');

		const segreto = typeof b.segreto === 'string' ? b.segreto.trim() : '';
		if (segreto) {
			if (!f.segreto) return errore(reply, 400, 'Questo fornitore non usa una credenziale.');
			if (!cifraturaDisponibile()) return errore(reply, 409, 'Manca CHIAVE_SEGRETI sul server: le credenziali non si possono salvare. Va impostata fra le variabili di Railway.');
			await salvaSegreto(p.id, canale, segreto);
		} else if (b.cancella_segreto) {
			await cancellaSegreto(p.id, canale);
		}
		// La verifica resta salvata: vale finché l'impronta corrisponde (shared/comunicazioni.js).
		await aggiorna((com) => {
			const prima = com.canali?.[canale] ?? {};
			com.canali = { ...com.canali, [canale]: { ...conf, verificato: prima.verificato ?? null } };
		});
		await traccia(request, etichettaCanale(canale), `Configurazione salvata (${f.etichetta})${segreto ? ', credenziale aggiornata' : b.cancella_segreto ? ', credenziale tolta' : ''}`);
		return vista();
	});

	/**
	 * POST /api/comunicazioni/canali/:canale/prova { a? } → { simulato, a, testo? }
	 *
	 * L'invio di prova a chi configura: un codice di sei cifre, da riscrivere per dire "è arrivato".
	 * Senza INVII_REALI (o per gli SMS, che non hanno un fornitore) va al finto, e la risposta
	 * mostra il messaggio: la verifica vale allora solo finché gli invii restano simulati.
	 */
	fastify.post('/api/comunicazioni/canali/:canale/prova', async (request, reply) => {
		const canale = request.params.canale;
		if (canale !== 'email' && canale !== 'sms') return errore(reply, 400, 'L\'invio di prova serve per email e SMS.');
		const ctx = await contesto(db);
		if (ctx.statiCanali[canale] === 'non_configurato') return errore(reply, 409, 'Prima completa la configurazione del canale.');
		const io = await nomeDi(request.utente);
		let a;
		if (canale === 'email') {
			a = String(request.body?.a ?? io.email ?? '').trim();
			if (!emailValida(a)) return errore(reply, 400, 'Indica l\'indirizzo a cui mandare la prova.');
		} else {
			a = normalizzaTelefono(request.body?.a ?? '');
			if (!/^\+\d{8,15}$/.test(a ?? '')) return errore(reply, 400, 'Indica il numero di telefono a cui mandare la prova.');
		}
		const codice = String(randomInt(0, 1_000_000)).padStart(6, '0');
		const conf = ctx.com.canali[canale];
		const testo = `${ctx.palestra.nome}: il codice di verifica delle comunicazioni è ${codice}. Riscrivilo in GRIP per confermare che i messaggi arrivano.`;
		// La prima serratura vale anche qui: niente INVII_REALI, niente invio vero.
		const reale = config.inviiReali && canale === 'email';
		try {
			const adattatore = reale ? email : finto;
			await adattatore.invia({ canale, a, oggetto: 'Verifica delle comunicazioni', testo, conf, segreto: reale ? await leggiSegreto(ctx.palestra.id, canale) : null });
		} catch (e) {
			request.log.warn({ err: e }, 'invio di prova non riuscito');
			return errore(reply, 502, `L'invio di prova non è riuscito: ${e.message}`);
		}
		await aggiorna((com) => {
			com.canali = { ...com.canali, [canale]: { ...com.canali?.[canale], prova: { hash: hash(codice), scade: Date.now() + CODICE_VALIDO_MINUTI * 60_000, reale } } };
		});
		await traccia(request, etichettaCanale(canale), `Invio di prova${reale ? '' : ' (simulato)'} a ${a}`);
		return { simulato: !reale, a, testo: reale ? undefined : testo };
	});

	/** POST /api/comunicazioni/canali/:canale/verifica { codice } → la sezione: il canale è pronto */
	fastify.post('/api/comunicazioni/canali/:canale/verifica', async (request, reply) => {
		const canale = request.params.canale;
		const codice = String(request.body?.codice ?? '').trim();
		const ctx = await contesto(db);
		const conf = ctx.com.canali[canale] ?? {};
		if (!conf.prova || conf.prova.scade < Date.now()) return errore(reply, 409, 'Il codice è scaduto o non c\'è: rifai l\'invio di prova.');
		if (hash(codice) !== conf.prova.hash) return errore(reply, 400, 'Il codice non corrisponde.');
		const io = await nomeDi(request.utente);
		await aggiorna((com) => {
			const { prova, ...resto } = com.canali[canale];
			com.canali = { ...com.canali, [canale]: { ...resto, verificato: { il: new Date().toISOString(), reale: prova.reale, da: io.nome, impronta: improntaCanale(resto, ctx.segreti[canale]?.aggiornato) } } };
		});
		await traccia(request, etichettaCanale(canale), `Canale verificato${conf.prova.reale ? '' : ' (in simulazione)'}`);
		return vista();
	});

	/** PUT /api/comunicazioni/playbook/:codice { stato: 'spento'|'anteprima'|'attivo' } */
	fastify.put('/api/comunicazioni/playbook/:codice', async (request, reply) => {
		const pb = playbookDi(request.params.codice);
		if (!pb) return errore(reply, 404, 'Playbook sconosciuto.');
		const stato = request.body?.stato;
		if (!statoPlaybookValido(stato)) return errore(reply, 400, 'Lo stato è spento, anteprima o attivo.');
		const prima = await aggiorna((com) => {
			const vecchio = com.playbook?.[pb.codice] ?? 'spento';
			com.playbook = { ...com.playbook, [pb.codice]: stato };
			return vecchio;
		});
		await traccia(request, `Playbook ${pb.titolo}`, 'Stato cambiato', { valorePrecedente: prima, valoreNuovo: stato });
		return vista();
	});

	/** PUT /api/comunicazioni/modelli/:codice/:canale { oggetto, testo } — il testo della palestra */
	fastify.put('/api/comunicazioni/modelli/:codice/:canale', async (request, reply) => {
		const pb = playbookDi(request.params.codice);
		const canale = request.params.canale;
		if (!pb || !pb.canali.includes(canale)) return errore(reply, 404, 'Questo playbook non usa questo canale.');
		const oggetto = String(request.body?.oggetto ?? '').trim();
		const testo = String(request.body?.testo ?? '').trim();
		if (!testo) return errore(reply, 400, 'Il testo non può essere vuoto.');
		if (canale !== 'sms' && !oggetto) return errore(reply, 400, 'Scrivi l\'oggetto (è anche il titolo della notifica).');
		if (oggetto.length > LIMITI_TESTO.oggetto) return errore(reply, 400, `L'oggetto supera i ${LIMITI_TESTO.oggetto} caratteri.`);
		const limite = canale === 'sms' ? LIMITI_TESTO.sms : LIMITI_TESTO.testo;
		if (testo.length > limite) return errore(reply, 400, `Il testo supera i ${limite} caratteri${canale === 'sms' ? ' (due SMS)' : ''}.`);
		const sconosciuti = segnapostoSconosciuti(`${oggetto} ${testo}`);
		if (sconosciuti.length) return errore(reply, 400, `Segnaposto sconosciuti: ${sconosciuti.map((s) => `{${s}}`).join(', ')}.`);
		const p = await palestra();
		const io = await nomeDi(request.utente);
		await db.insert(modelliMessaggio).values({ organizationId: p.id, playbook: pb.codice, canale, oggetto: canale === 'sms' ? null : oggetto, testo, autoreNome: io.nome })
			.onConflictDoUpdate({
				target: [modelliMessaggio.organizationId, modelliMessaggio.playbook, modelliMessaggio.canale],
				set: { oggetto: canale === 'sms' ? null : oggetto, testo, autoreNome: io.nome, updatedDate: new Date() },
			});
		await traccia(request, `Playbook ${pb.titolo}`, `Testo ${etichettaCanale(canale)} riscritto`);
		return vista();
	});

	/** DELETE /api/comunicazioni/modelli/:codice/:canale — si torna al testo predefinito */
	fastify.delete('/api/comunicazioni/modelli/:codice/:canale', async (request) => {
		const p = await palestra();
		await db.delete(modelliMessaggio).where(and(
			eq(modelliMessaggio.organizationId, p.id), eq(modelliMessaggio.playbook, request.params.codice), eq(modelliMessaggio.canale, request.params.canale),
		));
		await traccia(request, `Playbook ${playbookDi(request.params.codice)?.titolo ?? request.params.codice}`, `Testo ${etichettaCanale(request.params.canale)} tornato al predefinito`);
		return vista();
	});

	/**
	 * PUT /api/comunicazioni/conferme { voce: 'informativa'|'testi', fatta: bool }
	 * Le voci della lista di controllo che dipendono da una persona: l'informativa privacy
	 * aggiornata, i testi riletti. Si registra chi l'ha confermato e quando.
	 */
	fastify.put('/api/comunicazioni/conferme', async (request, reply) => {
		const { voce, fatta } = request.body ?? {};
		const chiave = { informativa: 'informativa', testi: 'testi_rivisti' }[voce];
		if (!chiave || typeof fatta !== 'boolean') return errore(reply, 400, 'Voce non valida.');
		const io = await nomeDi(request.utente);
		await aggiorna((com) => { com[chiave] = fatta ? { il: new Date().toISOString(), da: io.nome } : null; });
		await traccia(request, 'Lista di controllo', `${voce === 'informativa' ? 'Informativa privacy' : 'Testi riletti'}: ${fatta ? 'confermato' : 'tolto'}`);
		return vista();
	});

	/**
	 * PUT /api/comunicazioni/interruttore { attive }
	 * L'interruttore generale: si accende solo a lista di controllo completa; si spegne sempre.
	 */
	fastify.put('/api/comunicazioni/interruttore', async (request, reply) => {
		const attive = request.body?.attive;
		if (typeof attive !== 'boolean') return errore(reply, 400, 'Indica se accendere o spegnere.');
		if (attive) {
			const v = await vista();
			if (!v.lista.completa) return errore(reply, 409, `Prima completa la lista di controllo: ${v.lista.voci.filter((x) => !x.fatta).map((x) => x.etichetta.toLowerCase()).join('; ')}.`);
		}
		await aggiorna((com) => { com.attive = attive; });
		await traccia(request, 'Interruttore generale', attive ? 'Comunicazioni accese' : 'Comunicazioni spente', { valoreNuovo: String(attive) });
		return vista();
	});

	/**
	 * GET /api/comunicazioni/anteprima/:codice → { giorno, totale, per_canale, bloccati, esempi }
	 *
	 * "Domani sarebbero partiti 12 messaggi": il playbook calcolato per domani, come se fosse
	 * attivo, senza scrivere niente. Le occasioni già mandate davvero non si contano.
	 */
	fastify.get('/api/comunicazioni/anteprima/:codice', async (request, reply) => {
		const pb = playbookDi(request.params.codice);
		if (!pb) return errore(reply, 404, 'Playbook sconosciuto.');
		if (pb.immediato) return errore(reply, 400, 'Questo playbook parte con l\'evento (una lezione annullata, un posto liberato): non ha un\'anteprima del giorno.');
		const domani = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const ctx = await contesto(db, domani);
		const { oggi, occasioni } = await occasioniDelGiorno(db, { ctx, codici: [pb.codice], adesso: domani });
		const chiavi = occasioni.map((o) => chiaveMessaggio({ palestra: ctx.palestra.id, playbook: pb.codice, persona: o.persona.persona_id, riferimento: o.riferimento }));
		const gia = new Set(chiavi.length
			? (await db.select({ chiave: messaggi.chiave }).from(messaggi).where(sql`${messaggi.chiave} in ${chiavi}`)).map((r) => r.chiave)
			: []);
		const per_canale = {}; let bloccati = 0; let senzaCanale = 0; const esempi = [];
		occasioni.forEach((o, i) => {
			if (gia.has(chiavi[i])) return;
			const scelta = scegliCanale({ canali: o.canali, pronti: ctx.pronti, recapiti: o.persona.recapiti, tipo: pb.tipo, consensi: o.persona.consensi, minorenne: o.persona.minorenne, smsResidui: ctx.smsResidui });
			if (!scelta) { senzaCanale += 1; return; }
			if (scelta.stato !== 'ok') bloccati += 1;
			else per_canale[scelta.canale] = (per_canale[scelta.canale] ?? 0) + 1;
			if (esempi.length < 20) {
				esempi.push({
					persona_id: o.persona.persona_id, nome: o.persona.nome, canale: scelta.canale, stato: scelta.stato, motivo: scelta.motivo ?? null,
					...componi(ctx, pb.codice, scelta.canale, o.persona, o.valori),
				});
			}
		});
		const totale = Object.values(per_canale).reduce((a, b) => a + b, 0);
		return { giorno: oggi, totale, per_canale, bloccati, senza_canale: senzaCanale, esempi, canali_pronti: ctx.pronti };
	});

	/**
	 * POST /api/comunicazioni/anteprima-testo { playbook, canale, persona_id?, oggetto, testo } → { oggetto, testo }
	 * Come uscirebbe un testo (anche non ancora salvato) per una persona vera, o per l'esempio.
	 */
	fastify.post('/api/comunicazioni/anteprima-testo', async (request, reply) => {
		const { playbook: codice, canale, persona_id: personaId, oggetto = '', testo = '' } = request.body ?? {};
		const pb = playbookDi(codice);
		if (!pb || !pb.canali.includes(canale)) return errore(reply, 400, 'Playbook o canale non validi.');
		const ctx = await contesto(db);
		ctx.modelli = [{ playbook: codice, canale, oggetto, testo }];
		let persona = { persona_id: null, nome_proprio: SEGNAPOSTO.nome };
		let valori = { ...SEGNAPOSTO, palestra: ctx.palestra.nome };
		if (personaId) {
			const [p] = await db.select({ persona_id: persone.id, nome_proprio: persone.nome }).from(persone).where(eq(persone.id, personaId)).limit(1);
			if (!p) return errore(reply, 404, 'Persona non trovata.');
			persona = p;
			const { oggi, persone: trovate } = await situazioni({ personaId });
			const s = trovate[0];
			const o = s && occasione(codice, s, oggi);
			valori = { ...valori, nome: p.nome_proprio, abbonamento: s?.abbonamento ?? '', ...(o?.valori ?? {}) };
		}
		return componi(ctx, codice, canale, persona, valori);
	});

	/**
	 * GET /api/comunicazioni/messaggi?mese=AAAA-MM&stato= → { mese, messaggi, conti, costo_sms }
	 * Il registro: cosa è partito, cosa sarebbe partito, cosa è stato bloccato e perché.
	 */
	fastify.get('/api/comunicazioni/messaggi', async (request, reply) => {
		const mese = String(request.query?.mese ?? meseDi());
		if (!/^\d{4}-\d{2}$/.test(mese)) return errore(reply, 400, 'Il mese è nel formato AAAA-MM.');
		const [a, m] = mese.split('-').map(Number);
		const dopo = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
		const p = await palestra();
		const nelMese = and(
			eq(messaggi.organizationId, p.id),
			gte(messaggi.createdDate, sql`(${`${mese}-01`}::date)::timestamp AT TIME ZONE 'Europe/Rome'`),
			lt(messaggi.createdDate, sql`(${dopo}::date)::timestamp AT TIME ZONE 'Europe/Rome'`),
		);
		const stato = request.query?.stato;
		const righe = await db.select({
			id: messaggi.id, playbook: messaggi.playbook, canale: messaggi.canale, destinatario: messaggi.destinatario, oggetto: messaggi.oggetto,
			testo: messaggi.testo, stato: messaggi.stato, motivo: messaggi.motivo, costo_centesimi: messaggi.costoCentesimi,
			created_date: messaggi.createdDate, inviato_il: messaggi.inviatoIl, persona_id: messaggi.personaId, nome: persone.fullName,
		}).from(messaggi).leftJoin(persone, eq(messaggi.personaId, persone.id))
			.where(and(nelMese, stato ? eq(messaggi.stato, stato) : undefined)).orderBy(desc(messaggi.createdDate)).limit(500);
		const conti = await db.select({ stato: messaggi.stato, n: sql`count(*)`.mapWith(Number), costo: sql`coalesce(sum(${messaggi.costoCentesimi}) filter (where ${messaggi.canale} = 'sms' and ${messaggi.stato} in ('in_coda','inviato','consegnato')), 0)`.mapWith(Number) })
			.from(messaggi).where(nelMese).groupBy(messaggi.stato);
		return {
			mese, messaggi: righe,
			conti: Object.fromEntries(conti.map((c) => [c.stato, c.n])),
			costo_sms: conti.reduce((t, c) => t + c.costo, 0),
		};
	});
}
