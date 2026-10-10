// Gli invii: chi accoda un messaggio, chi lo spedisce, e il giro dei playbook.
//
// **Le tre serrature stanno in un punto solo, `accoda`.** Un messaggio esce davvero (stato
// `in_coda`, poi `inviato`) solo se:
//   1. il server ha `INVII_REALI` acceso (config.inviiReali) — senza, fornitore finto e `simulato`;
//   2. la palestra ha acceso le comunicazioni (`impostazioni.comunicazioni.attive`), cosa che la
//      sezione Comunicazioni permette solo a lista di controllo completa;
//   3. il canale è pronto (configurato e verificato con un invio di prova) e il playbook è `attivo`.
// Con una serratura chiusa il messaggio si scrive `simulato`: si vede cosa sarebbe partito, e
// non parte niente. Con il playbook `spento` non si scrive nemmeno quello.
//
// Le regole (chi, quando, su quale canale) sono in shared/comunicazioni.js; chi va contattato lo
// dice il motore dei segnali (lib/segnali.js). Qui solo dati, transazioni e fornitori.
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	organizations, messaggi, modelliMessaggio, members, persone, staffAccounts, consensi, attivita, notifiche,
} from '../db/schema/index.js';
import { config } from '../config.js';
import { situazioni } from './segnali.js';
import { righeConsensi } from './consensi.js';
import { statoSegreti, leggiSegreto } from './segreti.js';
import { linkDisiscrizione } from './urlFirmati.js';
import * as finto from './canali/finto.js';
import * as email from './canali/email.js';
import {
	PLAYBOOK, CANALI, playbook as playbookDi, occasione, scegliCanale, inSilenzio, smsResidui, meseDi,
	impostazioniComunicazioni, statoCanale, testoPer, riempi, chiaveMessaggio, emailValida,
} from '../../../shared/comunicazioni.js';
import { consensiAttuali } from '../../../shared/consensi.js';
import { eMinorenne } from '../../../shared/anagrafica.js';
import { oggiIso } from '../../../shared/giorni.js';

const AUTORE_SISTEMA = 'Sistema';
// Un freno a mano: un giro non accoda più di tanti messaggi veri per palestra. Un errore in una
// regola (una soglia a zero, una data sbagliata) non deve scrivere a tutti i soci in una notte.
// ponytail: un numero fisso; se una palestra grande ne avrà bisogno, diventa un'impostazione.
export const MASSIMO_PER_GIRO = 300;
// Gli stati che contano nel budget SMS: quelli che sono partiti o stanno per partire.
const STATI_SPESI = ['in_coda', 'inviato', 'consegnato'];

/** Gli adattatori veri, per canale. Il portale non ne ha bisogno (scrive una notifica); gli SMS non hanno ancora un fornitore. */
const ADATTATORI = { email };

// --- Il contesto della palestra -----------------------------------------------------------

/**
 * Tutto quello che serve per decidere: le impostazioni, i testi, i canali pronti, il budget.
 * ponytail: oggi c'è una palestra per installazione; con il multi-tenant si passerà la sua.
 */
export async function contesto(conn = db, adesso = new Date()) {
	const [palestra] = await conn.select({ id: organizations.id, nome: organizations.nome, impostazioni: organizations.impostazioni })
		.from(organizations).limit(1);
	if (!palestra) return null;
	const com = impostazioniComunicazioni(palestra.impostazioni?.comunicazioni);
	const segreti = await statoSegreti(palestra.id, conn);
	const statiCanali = Object.fromEntries(CANALI.map((c) => [c.valore, statoCanale(c.valore, com.canali[c.valore], { segreto: segreti[c.valore], inviiReali: config.inviiReali })]));
	const modelli = await conn.select({ playbook: modelliMessaggio.playbook, canale: modelliMessaggio.canale, oggetto: modelliMessaggio.oggetto, testo: modelliMessaggio.testo })
		.from(modelliMessaggio).where(eq(modelliMessaggio.organizationId, palestra.id));
	const spesi = await spesaSmsDelMese(conn, palestra.id, adesso);
	return {
		palestra: { id: palestra.id, nome: palestra.nome }, com, segreti, statiCanali, modelli,
		pronti: Object.entries(statiCanali).filter(([, s]) => s === 'pronto').map(([c]) => c),
		spesiSms: spesi,
		smsResidui: smsResidui({ budgetCentesimi: com.budget_sms_centesimi, spesiCentesimi: spesi, costoCentesimi: com.costo_sms_centesimi }),
	};
}

/** I centesimi spesi in SMS nel mese (a Roma), contando solo quelli partiti o in partenza. */
export async function spesaSmsDelMese(conn, organizationId, adesso = new Date()) {
	const inizio = `${meseDi(adesso)}-01`;
	const [r] = await conn.select({ tot: sql`coalesce(sum(${messaggi.costoCentesimi}), 0)`.mapWith(Number) }).from(messaggi)
		.where(and(
			eq(messaggi.organizationId, organizationId), eq(messaggi.canale, 'sms'), inArray(messaggi.stato, STATI_SPESI),
			gte(messaggi.createdDate, sql`(${inizio}::date)::timestamp AT TIME ZONE 'Europe/Rome'`),
		));
	return r?.tot ?? 0;
}

// --- I destinatari ------------------------------------------------------------------------

const linkPortale = (percorso) => `${String(config.publicBaseUrl ?? '').replace(/\/$/, '')}${percorso}`;

/**
 * Quello che serve sapere di una persona per scriverle: dove (recapiti), se può (consensi, età).
 * `righe`: [{ persona_id, socio_id, nome_proprio, email, telefono, nascita }]
 */
async function conRecapiti(conn, righe, oggi) {
	const idPersone = righe.map((r) => r.persona_id);
	const idSoci = righe.map((r) => r.socio_id).filter(Boolean);
	// Una dopo l'altra: `conn` può essere una transazione, che non regge due query insieme.
	// Con la prova: un consenso dato in reception senza il modulo firmato non vale (lib/consensi.js).
	const elencoConsensi = await righeConsensi(idPersone, conn);
	const account = idSoci.length
		? await conn.select({ socio_id: staffAccounts.linkedMemberId }).from(staffAccounts)
			.where(and(inArray(staffAccounts.linkedMemberId, idSoci), eq(staffAccounts.attivo, true)))
		: [];
	const conPortale = new Set(account.map((a) => a.socio_id));
	const consensiDi = new Map();
	for (const c of elencoConsensi) {
		if (!consensiDi.has(c.persona_id)) consensiDi.set(c.persona_id, []);
		consensiDi.get(c.persona_id).push(c);
	}
	return righe.map((r) => ({
		...r,
		recapiti: {
			app: Boolean(r.socio_id && conPortale.has(r.socio_id)),
			email: emailValida(r.email) ? String(r.email).trim() : null,
			// Solo i numeri in formato internazionale (shared/anagrafica.js): gli altri non si sa dove vanno.
			sms: /^\+\d{8,15}$/.test(String(r.telefono ?? '')) ? r.telefono : null,
		},
		consensi: consensiAttuali(consensiDi.get(r.persona_id) ?? []),
		minorenne: eMinorenne(r.nascita, oggi),
	}));
}

/** I soci (non archiviati) con i loro segnali di oggi, pronti per i playbook. */
async function destinatari(conn, adesso) {
	const { oggi, persone: elenco } = await situazioni({ conn, adesso });
	const soci = elenco.filter((p) => p.socio_id && !p.archiviato_il);
	return { oggi, persone: await conRecapiti(conn, soci, oggi) };
}

// --- Accodare: l'unico punto delle tre serrature -----------------------------------------

/**
 * Accoda un messaggio di un playbook per una persona, o lo scrive simulato, o bloccato.
 *
 * @param ctx        il contesto della palestra (`contesto`)
 * @param codice     il playbook
 * @param persona    { persona_id, socio_id, nome_proprio, recapiti, consensi, minorenne }
 * @param riferimento l'occasione (shared/comunicazioni.js, `occasione`): fa la chiave
 * @param canali     quelli dell'occasione
 * @param valori     i segnaposto in più
 * @returns { messaggio, nuovo } | null — null se il playbook è spento o nessun canale è possibile
 */
export async function accoda(conn, { ctx, codice, persona, riferimento, canali, valori = {}, adesso = new Date() }) {
	const stato = ctx.com.playbook[codice];
	if (!stato || stato === 'spento') return null;
	const pb = playbookDi(codice);
	const scelta = scegliCanale({
		canali, pronti: ctx.pronti, recapiti: persona.recapiti, tipo: pb.tipo, consensi: persona.consensi,
		minorenne: persona.minorenne, smsResidui: ctx.smsResidui,
	});
	if (!scelta) return null;

	// Le serrature. Il canale pronto (la terza) è già in `ctx.pronti`.
	const reale = config.inviiReali && ctx.com.attive && stato === 'attivo';
	let statoMessaggio;
	let motivo = scelta.motivo ?? null;
	if (!reale) {
		// Simulato anche quando sarebbe stato bloccato: il motivo lo dice, e la chiave dell'anteprima
		// non occupa il posto dell'invio vero.
		statoMessaggio = 'simulato';
		motivo = scelta.stato === 'ok' ? null : `sarebbe stato bloccato: ${scelta.motivo}`;
	} else if (scelta.stato !== 'ok') statoMessaggio = scelta.stato;
	// Il silenzio vale per i playbook del giro e per gli SMS. Un'email immediata (la lezione di
	// domattina annullata alle 22) parte: non sveglia nessuno, e domattina sarebbe tardi.
	else if ((!pb.immediato || scelta.canale === 'sms') && inSilenzio(adesso, ctx.com.silenzio)) {
		statoMessaggio = 'bloccato_silenzio';
		motivo = `fascia di silenzio (${ctx.com.silenzio.dalle}–${ctx.com.silenzio.alle})`;
	} else statoMessaggio = 'in_coda';

	const canale = scelta.canale;
	const { oggetto, testo } = componi(ctx, codice, canale, persona, valori);
	const costo = canale === 'sms' ? ctx.com.costo_sms_centesimi : 0;
	const riga = {
		organizationId: ctx.palestra.id, personaId: persona.persona_id, playbook: codice, canale,
		destinatario: canale === 'app' ? persona.socio_id : persona.recapiti[canale],
		oggetto: oggetto ? oggetto.slice(0, 200) : null, testo, stato: statoMessaggio, motivo: motivo?.slice(0, 255) ?? null,
		costoCentesimi: costo,
		chiave: chiaveMessaggio({ palestra: ctx.palestra.id, playbook: codice, persona: persona.persona_id, riferimento, simulato: !reale }),
	};

	// Un SMS vero passa dal budget dentro un lucchetto della palestra: due giri (o un giro e un
	// avviso immediato) nello stesso istante non sforano il tetto contando la stessa spesa.
	if (statoMessaggio === 'in_coda' && canale === 'sms') {
		return conn.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sms:${ctx.palestra.id}`}))`);
			const spesi = await spesaSmsDelMese(tx, ctx.palestra.id, adesso);
			if (spesi + costo > ctx.com.budget_sms_centesimi) {
				Object.assign(riga, { stato: 'bloccato_budget', motivo: 'budget SMS del mese esaurito' });
			}
			const esito = await inserisci(tx, riga);
			if (esito.nuovo && riga.stato === 'in_coda') ctx.smsResidui -= 1;
			return esito;
		});
	}
	return inserisci(conn, riga);
}

async function inserisci(conn, riga) {
	const [nuovo] = await conn.insert(messaggi).values(riga).onConflictDoNothing({ target: messaggi.chiave }).returning();
	return nuovo ? { messaggio: nuovo, nuovo: true } : { messaggio: null, nuovo: false };
}

/** Oggetto e testo di un messaggio: il modello della palestra (o il predefinito) con i segnaposto. */
export function componi(ctx, codice, canale, persona, valori = {}) {
	const pb = playbookDi(codice);
	const modello = testoPer(codice, canale, ctx.modelli);
	const tutti = {
		nome: persona.nome_proprio ?? '', palestra: ctx.palestra.nome,
		link_rinnovo: linkPortale('/member-portal/abbonamento'), ...valori,
	};
	let testo = riempi(modello.testo, tutti);
	// Le promozioni portano sempre il modo per smettere di riceverle.
	const link = disiscrizioneDi(codice, canale, persona.persona_id);
	if (link) testo += canale === 'sms' ? ` Stop: ${link}` : `\n\nNon vuoi più ricevere questi messaggi? ${link}`;
	return { oggetto: riempi(modello.oggetto, tutti), testo };
}

/** Il link di disiscrizione di un messaggio promozionale fuori dal portale; null per il servizio. */
function disiscrizioneDi(codice, canale, personaId) {
	if (playbookDi(codice)?.tipo !== 'marketing' || canale === 'app' || !personaId) return null;
	return linkDisiscrizione(personaId, CANALI.find((c) => c.valore === canale).consenso, linkPortale('/disiscrizione'));
}

// --- Spedire ------------------------------------------------------------------------------

/**
 * Spedisce i messaggi in coda, uno alla volta: ognuno in una transazione che lo blocca, così
 * due spedizioni nello stesso momento non mandano lo stesso messaggio due volte.
 *
 * ponytail: la chiamata al fornitore avviene dentro la transazione (tiene una connessione e il
 * lucchetto della riga per qualche secondo); se il fornitore accetta e poi il commit fallisce, il
 * messaggio ripartirebbe al giro dopo. Con volumi veri: segnare la riga "in invio", chiudere,
 * spedire fuori, poi aggiornare.
 *
 * @param adattatori  per i test: chi spedisce, canale per canale
 * @returns { inviati, falliti }
 */
export async function spedisci(conn = db, { adattatori = ADATTATORI, limite = MASSIMO_PER_GIRO * 2, log, adesso = new Date() } = {}) {
	const ctx = await contesto(conn, adesso);
	if (!ctx) return { inviati: 0, falliti: 0 };
	const segreti = {};
	const esito = { inviati: 0, falliti: 0 };
	for (let i = 0; i < limite; i += 1) {
		const fatto = await conn.transaction(async (tx) => {
			const [m] = await tx.select().from(messaggi)
				.where(and(eq(messaggi.stato, 'in_coda'), eq(messaggi.organizationId, ctx.palestra.id)))
				.orderBy(messaggi.createdDate).limit(1).for('update', { skipLocked: true });
			if (!m) return null;
			// Le serrature, di nuovo, al momento di spedire: spento l'interruttore o il playbook,
			// o il canale non più pronto, quello che era in coda non parte più.
			const fermo = !ctx.com.attive ? 'comunicazioni spente prima dell\'invio'
				: ctx.com.playbook[m.playbook] !== 'attivo' ? 'playbook non più attivo prima dell\'invio'
					: !ctx.pronti.includes(m.canale) ? 'canale non più pronto prima dell\'invio' : null;
			if (fermo) {
				await tx.update(messaggi).set({ stato: 'fallito', motivo: `Fermato: ${fermo}` }).where(eq(messaggi.id, m.id));
				return 'fallito';
			}
			// In silenzio resta in coda: lo spedisce il giro di domani mattina (un SMS sempre;
			// un'email solo se non è immediata, come in `accoda`).
			if ((m.canale === 'sms' || !playbookDi(m.playbook)?.immediato) && inSilenzio(adesso, ctx.com.silenzio)) return 'silenzio';
			try {
				// Un punto di salvataggio: se qualcosa qui dentro fallisce (un socio cancellato nel
				// frattempo), si torna qui e il messaggio si segna non riuscito, invece di bloccare la coda.
				await tx.transaction(async (sp) => {
				let risultato;
				if (m.canale === 'app') {
					await sp.insert(notifiche).values({ memberId: m.destinatario, tipo: m.playbook, titolo: (m.oggetto ?? 'Avviso').slice(0, 160), testo: m.testo });
					risultato = { idFornitore: null, costoCentesimi: 0 };
				} else {
					const conf = ctx.com.canali[m.canale];
					if (!(m.canale in segreti)) segreti[m.canale] = await leggiSegreto(ctx.palestra.id, m.canale, tx);
					// La prima serratura, ancora una volta: senza INVII_REALI anche un messaggio finito
					// in coda per errore va al finto. E gli SMS, finché non c'è un fornitore, pure.
					const adattatore = config.inviiReali ? (adattatori[m.canale] ?? finto) : finto;
					// La disiscrizione con un clic dal programma di posta (RFC 8058): Gmail e gli altri la chiedono.
					const link = m.canale === 'email' ? disiscrizioneDi(m.playbook, m.canale, m.personaId) : null;
					const intestazioni = link ? { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
					risultato = await adattatore.invia({ canale: m.canale, a: m.destinatario, oggetto: m.oggetto ?? '', testo: m.testo, conf, segreto: segreti[m.canale], intestazioni });
				}
				await sp.update(messaggi).set({
					stato: 'inviato', inviatoIl: new Date(), idFornitore: risultato.idFornitore ?? null,
					costoCentesimi: m.canale === 'sms' ? m.costoCentesimi : (risultato.costoCentesimi ?? 0),
				}).where(eq(messaggi.id, m.id));
				// Nel diario: chi legge la scheda deve sapere che cosa gli è arrivato, e quando.
				if (m.personaId) {
					await sp.insert(attivita).values({
						personaId: m.personaId, tipo: 'messaggio', canale: m.canale, esito: m.playbook, autoreNome: AUTORE_SISTEMA,
						nota: (m.oggetto || m.testo).slice(0, 500), riferimento: { messaggio: m.id },
					});
				}
				});
				return 'inviato';
			} catch (errore) {
				log?.warn?.({ err: errore, messaggio: m.id }, 'invio non riuscito');
				await tx.update(messaggi).set({ stato: 'fallito', motivo: String(errore.message ?? errore).slice(0, 255) }).where(eq(messaggi.id, m.id));
				return 'fallito';
			}
		});
		if (!fatto || fatto === 'silenzio') break;
		esito[fatto === 'inviato' ? 'inviati' : 'falliti'] += 1;
	}
	return esito;
}

// Dopo un avviso immediato la spedizione parte da sola, fuori dalla transazione di chi l'ha
// accodato: un fornitore lento non deve tenere ferma l'annullamento di una lezione.
// ponytail: un timer nel processo, con un attimo di ritardo perché la transazione si chiuda; se il
// processo si ferma prima, il messaggio resta in coda e lo spedisce il giro.
let spedizioneProgrammata = null;
function programmaSpedizione() {
	if (spedizioneProgrammata) return;
	spedizioneProgrammata = setTimeout(() => {
		spedizioneProgrammata = null;
		spedisci(db).catch((errore) => console.error('Spedizione non riuscita:', errore.message));
	}, 2000);
	spedizioneProgrammata.unref?.();
}

// --- Gli avvisi immediati -----------------------------------------------------------------

/**
 * La parte "fuori dal portale" di un avviso immediato (la lezione annullata, il posto dalla
 * lista d'attesa): email o SMS, se il playbook è acceso. Si accoda dentro la transazione di chi
 * fa la cosa: o la lezione è annullata e il messaggio è in coda, o nessuna delle due.
 *
 * @param idSoci       a chi
 * @param avviso       { titolo, testo } — gli stessi della notifica nel portale
 * @param riferimento  l'evento (la lezione, la prenotazione): fa la chiave
 * @returns quanti messaggi ha accodato o simulato
 */
export async function accodaAvviso(tx, codice, idSoci, avviso, riferimento, adesso = new Date()) {
	const ctx = await contesto(tx, adesso);
	if (!ctx || (ctx.com.playbook[codice] ?? 'spento') === 'spento' || !idSoci.length) return 0;
	const righe = await tx.select({
		persona_id: persone.id, socio_id: members.id, nome_proprio: persone.nome, email: persone.email, telefono: persone.telefono, nascita: members.dateOfBirth,
	}).from(members).innerJoin(persone, eq(members.personaId, persone.id)).where(inArray(members.id, idSoci));
	let quanti = 0;
	for (const persona of await conRecapiti(tx, righe, oggiIso(adesso))) {
		const esito = await accoda(tx, {
			ctx, codice, persona, riferimento: `${riferimento}:${persona.socio_id}`, canali: playbookDi(codice).canali,
			valori: { titolo: avviso.titolo, avviso: avviso.testo.replace(/^./, (c) => c.toLowerCase()) }, adesso,
		});
		if (esito?.nuovo) {
			quanti += 1;
			if (esito.messaggio.stato === 'in_coda') programmaSpedizione();
		}
	}
	return quanti;
}

// --- Il giro dei playbook -----------------------------------------------------------------

/**
 * Le occasioni di oggi per i playbook chiesti, con la decisione su ciascuna. Non scrive niente:
 * la usano il giro (che poi accoda) e l'anteprima della sezione Comunicazioni.
 */
export async function occasioniDelGiorno(conn, { ctx, codici, adesso = new Date() }) {
	const { oggi, persone: elenco } = await destinatari(conn, adesso);
	const risultato = [];
	for (const codice of codici) {
		for (const p of elenco) {
			const o = occasione(codice, p, oggi);
			if (o) risultato.push({ codice, persona: p, ...o });
		}
	}
	return { oggi, occasioni: risultato };
}

/**
 * Il giro degli invii, per la palestra: i playbook in anteprima scrivono `simulato`, quelli attivi
 * accodano (dietro le serrature), poi si spedisce la coda.
 *
 * Nella fascia di silenzio non si accoda niente: il giro dopo le 9 troverà le stesse occasioni
 * (le finestre durano più di un giorno). Lanciato due volte, il secondo non trova niente di nuovo:
 * la chiave di ogni occasione è unica.
 *
 * @returns { simulati, accodati, bloccati, inviati, falliti, silenzio, freno }
 */
export async function giroInvii(conn = db, { adesso = new Date(), adattatori, log } = {}) {
	const esito = { simulati: 0, accodati: 0, bloccati: 0, inviati: 0, falliti: 0, silenzio: false, freno: false };
	const ctx = await contesto(conn, adesso);
	if (!ctx) return esito;
	const codici = PLAYBOOK.filter((p) => !p.immediato && ctx.com.playbook[p.codice] !== 'spento').map((p) => p.codice);
	if (codici.length) {
		if (inSilenzio(adesso, ctx.com.silenzio)) esito.silenzio = true;
		else {
			const { occasioni } = await occasioniDelGiorno(conn, { ctx, codici, adesso });
			for (const o of occasioni) {
				if (esito.accodati >= MASSIMO_PER_GIRO) { esito.freno = true; break; }
				const r = await accoda(conn, { ctx, codice: o.codice, persona: o.persona, riferimento: o.riferimento, canali: o.canali, valori: o.valori, adesso });
				if (!r?.nuovo) continue;
				const s = r.messaggio.stato;
				if (s === 'simulato') esito.simulati += 1;
				else if (s === 'in_coda') esito.accodati += 1;
				else esito.bloccati += 1;
			}
		}
	}
	const spedizione = await spedisci(conn, { adattatori, log, adesso });
	esito.inviati = spedizione.inviati;
	esito.falliti = spedizione.falliti;
	return esito;
}
