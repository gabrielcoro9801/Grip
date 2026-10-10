// Regole per-entità applicate dall'endpoint generico: campi che non devono mai
// uscire dall'API, e trasformazioni da applicare in scrittura.
import bcrypt from 'bcryptjs';
import { and, asc, count, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { firmaUrl, togliFirma } from '../lib/urlFirmati.js';
import { db } from '../db/client.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import {
	plans, rooms, sessions, subscriptions, members, courses, instructors, events as eventsTable, staffAccounts,
} from '../db/schema/index.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';
import { usoDellaSala } from '../lib/sale.js';
import { iscrizioniPerSocio } from '../lib/iscrizioni.js';
import { translateToSnakeCase } from './columnMaps.js';
import {
	sessoValido, normalizzaCodiceFiscale, codiceFiscaleValido, motivoDocumentoNonValido, tipoDocumentoValido,
	normalizzaPartitaIva, partitaIvaValida, NOTE_ISTRUTTORE_MASSIMO, NOTE_SOCIO_MASSIMO, motivoDataNascitaNonValida,
	normalizzaTelefono,
} from '../../../shared/anagrafica.js';
import {
	unitaDurataValida, statoTipoValido, motivoCambioStatoNonValido, motivoNonVendibile, dataFineAbbonamento,
	oggiIso, NOTE_MASSIMO, statoIscrizione,
} from '../../../shared/abbonamenti.js';
import {
	statoSalaValido, motivoSospensioneNonValida, messaggioSospensioneBloccata,
	motivoSalaNonPrenotabile, messaggioAnnullaInveceDiEliminare, SALA_PRENOTATA, SALA_GIA_ANNULLATA, azioneSullaSala,
	motivoCambioStatoNonValido as motivoCambioStatoSalaNonValido,
	NOME_MASSIMO as NOME_SALA_MASSIMO, NOTE_MASSIMO as NOTE_SALA_MASSIMO,
} from '../../../shared/sale.js';
import { NOTE_CORSO_MASSIMO, RICORRENZE_CREABILI, DISDETTA_MASSIMA_ORE } from '../../../shared/corsi.js';

// Campi rimossi da ogni risposta, per entità.
const HIDDEN_FIELDS = {
	StaffAccount: ['password_hash', 'token_version'],
};

// Entità che non possono essere create, modificate o cancellate dall'endpoint generico,
// con il motivo mostrato a chi ci prova.
//
// Le prenotazioni si fanno e si disfano solo da `/api/prenotazioni`: lì posti e lista d'attesa
// si contano in una transazione con la lezione bloccata. Dall'endpoint generico chi aveva il
// calendario creava una prenotazione con lo stato che voleva — "confermata" su una lezione
// piena — o ne cancellava una confermata senza che nessuno in attesa venisse promosso.
const SOLO_DA_PRENOTAZIONI = 'Le prenotazioni si fanno e si disdicono dalle loro rotte, che contano i posti.';
export const CREATE_FORBIDDEN = { Booking: SOLO_DA_PRENOTAZIONI };
export const UPDATE_FORBIDDEN = { Booking: SOLO_DA_PRENOTAZIONI };
export const DELETE_FORBIDDEN = {
	// Le iscrizioni vendute puntano al tipo: cancellarlo lascerebbe iscrizioni senza origine.
	Plan: "Un abbonamento del catalogo non si elimina: si sospende o si annulla.",
	Booking: SOLO_DA_PRENOTAZIONI,
};

/**
 * Campi che nessuna scrittura dall'API sceglie: la chiave e le date di sistema.
 *
 * `PUT` scriveva qualunque colonna presente nel corpo, `id` compreso: si poteva cambiare la
 * chiave primaria di una riga, e con lei staccarla da tutto ciò che la cita.
 */
const CAMPI_DI_SISTEMA = ['id', 'created_date'];

export function togliCampiDiSistema(corpo) {
	if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return corpo;
	const pulito = { ...corpo };
	for (const campo of CAMPI_DI_SISTEMA) delete pulito[campo];
	return pulito;
}

/**
 * Motivo per cui una singola riga non è modificabile, se ce n'è uno.
 *
 * @param corpo quello che la modifica vorrebbe scrivere: alcune regole dipendono da com'è la
 *              riga oggi e da come diventerebbe (un tipo annullato non torna attivo).
 */
export async function mutationBlockedReason(entityName, _table, id, operazione, corpo) {
	if (entityName === 'Plan' && operazione === 'update' && corpo && presente(corpo, 'stato')) {
		const [tipo] = await db.select({ stato: plans.stato }).from(plans).where(eq(plans.id, id)).limit(1);
		if (tipo) return motivoCambioStatoNonValido(tipo.stato, corpo.stato);
	}
	if (entityName === 'Room' && operazione === 'update' && corpo && presente(corpo, 'stato')) {
		const [sala] = await db.select({ stato: rooms.stato }).from(rooms).where(eq(rooms.id, id)).limit(1);
		const nonValido = sala && motivoCambioStatoSalaNonValido(sala.stato, corpo.stato);
		if (nonValido) return nonValido;
		if (corpo.stato === 'sospeso') return salaNonSospendibile(id, corpo.sospesa_dal, corpo.sospesa_al);
		// Annullare è definitivo, quindi vale la stessa soglia dell'eliminazione: finché ci sono
		// lezioni da qui in avanti, quella stanza serve a qualcuno. Solo nel passaggio, però: il
		// modulo manda sempre lo stato, e rinominare una sala già annullata non è annullarla di
		// nuovo — prima falliva appena compariva una lezione futura, con un rifiuto incomprensibile.
		if (corpo.stato === 'annullato' && sala?.stato !== 'annullato' && (await usoDellaSala(id)).occupataDaQui) {
			return rifiutoSala(SALA_PRENOTATA, 'sala_prenotata');
		}
	}
	if (entityName === 'Room' && operazione === 'delete') {
		return salaNonEliminabile(id);
	}
	// Una modifica sposta l'evento, o la singola lezione, in un'altra sala o in altre date: il
	// controllo va rifatto su com'è la riga *dopo*, non su quello che arriva nel corpo. Anche
	// allungarlo conta — una nuova data di fine o nuove date personalizzate possono finire dentro
	// una sospensione — e prima guardava solo sala e data d'inizio.
	if (entityName === 'Event' && operazione === 'update' && corpo && CAMPI_PERIODO_EVENTO.some((c) => presente(corpo, c))) {
		const [attuale] = await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1);
		if (attuale) return motivoEventoInSalaNonPrenotabile({ ...translateToSnakeCase(eventsTable, attuale), ...corpo });
	}
	// Riattivare una lezione annullata la rimette in una sala: che nel frattempo può essere stata
	// annullata o sospesa proprio quel giorno.
	const riattiva = corpo?.status === 'active';
	if (entityName === 'Session' && operazione === 'update' && corpo && (presente(corpo, 'room_id') || presente(corpo, 'date') || riattiva)) {
		const [attuale] = await db.select({ data: sessions.date, salaId: sessions.roomId }).from(sessions).where(eq(sessions.id, id)).limit(1);
		if (attuale) {
			const data = corpo.date ?? attuale.data;
			return motivoSalaNonDisponibile(corpo.room_id ?? attuale.salaId, data, data);
		}
	}
	return null;
}

const CAMPI_PERIODO_EVENTO = ['room_id', 'start_date', 'end_date', 'end_condition', 'occurrence_count', 'custom_dates', 'recurrence_type'];

/**
 * Perché la sala non si può sospendere in quel periodo, o null.
 *
 * Comandano gli eventi: sotto le lezioni già fissate — su cui i soci sono già prenotati — la
 * sala non si chiude. Chi la vuole sospendere elimina prima quegli eventi, e a quel punto la
 * sospensione passa.
 */
async function salaNonSospendibile(id, dal, al) {
	if (motivoSospensioneNonValida(dal, al)) return null; // lo dice già la trasformazione in scrittura
	const [sala] = await db.select({ name: rooms.name }).from(rooms).where(eq(rooms.id, id)).limit(1);
	if (!sala) return null;
	const occupate = await db
		.select({ data: sessions.date })
		.from(sessions)
		.where(and(eq(sessions.roomId, id), ne(sessions.status, 'cancelled'), gte(sessions.date, dal), lte(sessions.date, al)))
		.orderBy(asc(sessions.date));
	if (!occupate.length) return null;
	return rifiutoSala(messaggioSospensioneBloccata(sala.name, dal, al, occupate.map((r) => r.data)), 'sala_non_sospendibile');
}

/**
 * Perché la sala non si può eliminare, o null.
 *
 * Si elimina una sala che non è mai stata niente per nessuno: creata per sbaglio, o con il nome
 * scritto male e rifatta. Tutto il resto no, e per due ragioni diverse. Se ha ospitato lezioni
 * già passate, cancellarla toglierebbe il "dove" a un pezzo di calendario accaduto davvero:
 * quella si annulla. Se ha lezioni da qui in avanti non si tocca affatto — ci sono soci
 * prenotati su appuntamenti che devono ancora arrivare.
 *
 * Il conto guarda anche le lezioni e non solo gli eventi: una lezione si sposta in un'altra
 * sala una alla volta, e la sala d'arrivo si ritrova occupata da qualcosa il cui evento sta
 * altrove.
 */
async function salaNonEliminabile(id) {
	const [sala] = await db.select({ name: rooms.name, stato: rooms.stato }).from(rooms).where(eq(rooms.id, id)).limit(1);
	if (!sala) return null;
	// Il conto è quello della pagina delle sale (lib/sale.js), e la decisione è la regola
	// condivisa: prima qui ce n'era una seconda copia, scritta a mano.
	const { eventi, lezioni, occupataDaQui } = await usoDellaSala(id);
	const annullata = sala.stato === 'annullato';
	const azione = azioneSullaSala({ maiUsata: !eventi && !lezioni, occupataDaQui, annullata });
	if (azione === 'elimina') return null;
	if (occupataDaQui) return rifiutoSala(SALA_PRENOTATA, 'sala_prenotata');
	if (annullata) return rifiutoSala(SALA_GIA_ANNULLATA, 'sala_gia_annullata');
	return rifiutoSala(messaggioAnnullaInveceDiEliminare(sala.name, { eventi, lezioni }), 'sala_da_annullare');
}

/** Perché quella sala non si può usare fra `inizio` e `fine`, o null. `fine` null = senza fine nota. */
async function motivoSalaNonDisponibile(idSala, inizio, fine) {
	if (!idSala || !inizio) return null;
	const [sala] = await db.select().from(rooms).where(eq(rooms.id, idSala)).limit(1);
	if (!sala) return null;
	return motivoSalaNonPrenotabile(translateToSnakeCase(rooms, sala), inizio, fine);
}

/**
 * Il periodo coperto da un evento: dalla prima all'ultima lezione.
 *
 * Un settimanale contato a occorrenze non sa in che giorno finisce finché non genera le
 * sessioni: `null` dice "senza fine nota", e `sospensioneTocca` lo tratta come sovrapposto —
 * meglio un rifiuto da spiegare che una lezione dentro una sala chiusa.
 */
function periodoEvento(evento) {
	const inizio = evento.start_date;
	if (evento.recurrence_type === 'custom') {
		const date = Array.isArray(evento.custom_dates) ? [...evento.custom_dates].sort() : [];
		return date.length ? [date[0], date[date.length - 1]] : [inizio, inizio];
	}
	if (evento.recurrence_type === 'weekly') {
		return [inizio, evento.end_condition === 'by_date' ? evento.end_date : null];
	}
	return [inizio, inizio];
}

function motivoEventoInSalaNonPrenotabile(evento) {
	const [inizio, fine] = periodoEvento(evento);
	return motivoSalaNonDisponibile(evento.room_id, inizio, fine);
}

/**
 * Un rifiuto dalla trasformazione in scrittura.
 *
 * Porta il codice 400, che il gestore degli errori (routes/errorHandler.js) rimanda al client
 * col messaggio: chi compila il modulo deve leggere cosa correggere, non "errore interno".
 */
/**
 * Un rifiuto sulle sale, con un codice oltre al messaggio.
 *
 * La pagina delle sale decide quale finestra mostrare a seconda del rifiuto, e lo riconosceva
 * dal testo italiano (`/non si elimina/`, `/sospendere/`): alla prima riformulazione il
 * riconoscimento avrebbe smesso di funzionare, senza nessun errore. Il codice non cambia
 * quando cambiano le parole.
 */
function rifiutoSala(messaggio, codice) {
	return { error: messaggio, code: codice };
}

/** Il rifiuto per chi prova a vendere o prenotare qualcosa a un socio archiviato. */
export const SOCIO_ARCHIVIATO = 'Il socio è archiviato: riattivalo dalla sua scheda per vendergli abbonamenti o prenotare.';

export function rifiuta(messaggio) {
	const errore = new Error(messaggio);
	errore.statusCode = 400;
	return errore;
}

const presente = (corpo, campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
const vuoto = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Le regole dell'anagrafica di un socio, valide per ogni strada da cui ne nasce uno: il modulo
 * dei soci e la trasformazione di un lead (routes/lead.js).
 *
 * In creazione tutto deve esserci. In modifica si controlla solo quello che arriva: un socio
 * registrato prima che il codice fiscale fosse obbligatorio resta modificabile nel resto, ma
 * il codice non si può svuotare né scrivere sbagliato.
 */
export function anagraficaSocio(corpo, { creazione }) {
	const { full_name: _calcolato, ...rest } = corpo ?? {};

	for (const campo of ['nome', 'cognome']) {
		if (presente(rest, campo)) rest[campo] = String(rest[campo] ?? '').trim();
		if ((creazione || presente(rest, campo)) && vuoto(rest[campo])) {
			throw rifiuta(campo === 'nome' ? 'Il nome è obbligatorio.' : 'Il cognome è obbligatorio.');
		}
	}
	if ((creazione || presente(rest, 'sesso')) && !sessoValido(rest.sesso)) {
		throw rifiuta('Indica il sesso: M, F o Altro.');
	}
	if (creazione || presente(rest, 'codice_fiscale')) {
		if (vuoto(rest.codice_fiscale)) throw rifiuta('Il codice fiscale è obbligatorio.');
		rest.codice_fiscale = normalizzaCodiceFiscale(rest.codice_fiscale);
		if (!codiceFiscaleValido(rest.codice_fiscale)) throw rifiuta('Il codice fiscale non è valido: controlla di averlo scritto bene.');
	}
	// Come il codice fiscale: obbligatoria su ogni socio nuovo e su ogni modifica che la tocca.
	// I soci registrati prima ne sono senza, e la inseriranno alla prima correzione dell'anagrafica.
	if (creazione || presente(rest, 'date_of_birth')) {
		const motivo = motivoDataNascitaNonValida(rest.date_of_birth);
		if (motivo) throw rifiuta(motivo);
		rest.date_of_birth = String(rest.date_of_birth).slice(0, 10);
	}
	if (presente(rest, 'notes')) {
		rest.notes = vuoto(rest.notes) ? null : String(rest.notes).trim() || null;
		if (rest.notes && rest.notes.length > NOTE_SOCIO_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_SOCIO_MASSIMO} caratteri.`);
	}
	for (const campo of ['phone', 'emergency_contact_phone']) {
		if (presente(rest, campo)) rest[campo] = telefonoNormalizzato(rest[campo]);
	}
	if (presente(rest, 'email')) rest.email = vuoto(rest.email) ? null : String(rest.email).trim();
	if (!creazione) rest.updated_date = new Date().toISOString();
	return rest;
}

/**
 * Un telefono come si salva: in formato internazionale (shared/anagrafica.js), null se vuoto.
 * Uno che non è un numero si rifiuta: salvato com'è, non si ritroverebbe e non riceverebbe niente.
 */
export function telefonoNormalizzato(valore) {
	if (vuoto(valore)) return null;
	const numero = normalizzaTelefono(valore);
	if (!numero) throw rifiuta(`Il numero «${String(valore).trim()}» non è un telefono valido.`);
	return numero;
}

// Trasformazioni in scrittura: il frontend continua a inviare `password` in chiaro
// per compatibilità con i form esistenti, ma qui viene hashata in password_hash —
// la password in chiaro non tocca mai il database.
const WRITE_TRANSFORMS = {
	// Versione della sessione e obbligo di cambio non si scrivono da fuori: li decide questa
	// regola. Una password scelta da qualcun altro — un amministratore che crea l'account o la
	// reimposta — chiude le sessioni già aperte e va cambiata al primo accesso. Prima il reset
	// aggiornava l'hash e basta: la finestra diceva "quella attuale smette subito di
	// funzionare", ma chi era già dentro restava dentro fino a trenta giorni.
	//
	// Il ruolo non serve toccarlo qui: la sessione con un ruolo diverso da quello nel database
	// non vale più (auth/revoca.js). Nemmeno la disattivazione: un account spento è già fuori.
	async StaffAccount(body, { creazione, utente, id }) {
		const {
			password, password_hash: _hash, token_version: _versione, password_da_cambiare: _obbligo, ...rest
		} = body ?? {};
		if (creazione && !password) throw rifiuta('La password è obbligatoria.');
		// L'istruttore collegato (la vista "Le mie lezioni"): uno che esiste, o nessuno. Un account
		// del portale è un socio, non un istruttore.
		if (presente(rest, 'instructor_id')) {
			if (vuoto(rest.instructor_id)) rest.instructor_id = null;
			else {
				if (rest.ruolo === 'member') throw rifiuta("Un account del portale non si collega a un istruttore.");
				const [istruttore] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.id, rest.instructor_id)).limit(1);
				if (!istruttore) throw rifiuta("L'istruttore scelto non esiste più.");
			}
		}
		if (password) {
			const nonValida = motivoPasswordNonValida(password);
			if (nonValida) throw rifiuta(nonValida);
			rest.password_hash = await bcrypt.hash(password, 10);
			// Chi si reimposta la propria password da qui l'ha scelta da sé: nessun obbligo.
			const perSe = !creazione && utente?.sub && String(utente.sub) === String(id);
			rest.password_da_cambiare = !perSe;
			if (!creazione) rest.token_version = sql`${staffAccounts.tokenVersion} + 1`;
		}
		return rest;
	},

	// Il codice socio veniva calcolato nel browser sul massimo fra i soci *già caricati*
	// in pagina: bastavano due iscrizioni contemporanee, o una lista non aggiornata, per
	// assegnare lo stesso codice a due persone. Ora arriva dal contatore.
	//
	// `full_name` si scarta: è calcolato dal database da nome e cognome, e scriverlo farebbe
	// fallire l'inserimento.
	async Member(body, { creazione }) {
		const { archiviato_il: _archivio, persona_id: _persona, ...corpo } = body ?? {};
		// L'archiviazione passa dalle sue rotte (routes/soci.js), che fanno anche il resto:
		// disdire le prenotazioni future, lasciarne traccia nel registro. La persona la sceglie
		// solo l'iscrizione di un contatto (routes/lead.js); per gli altri la crea il database:
		// spostare un socio su un'altra persona gli darebbe il diario di qualcun altro.
		const rest = anagraficaSocio(corpo, { creazione });
		// Il codice è la chiave del socio: lo decide sempre il contatore, anche se il modulo ne
		// manda uno, e non si riscrive in modifica.
		if (creazione) rest.codice_socio = await assegnaCodiceSocio(db);
		else delete rest.codice_socio;
		return rest;
	},

	// Un tipo di abbonamento nasce completo e attivo, e poi si tocca solo nello stato: nome,
	// prezzo e durata sono quelli con cui le iscrizioni sono state vendute.
	async Plan(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (!creazione) {
			const campi = Object.keys(rest).filter((k) => !['id', 'stato', 'created_date', 'updated_date'].includes(k));
			if (campi.length) throw rifiuta("Di un abbonamento del catalogo si cambia solo lo stato.");
			if (!statoTipoValido(rest.stato)) throw rifiuta('Stato non valido: attivo, sospeso o annullato.');
			return { stato: rest.stato, updated_date: new Date().toISOString() };
		}
		rest.name = String(rest.name ?? '').trim();
		if (!rest.name) throw rifiuta("Il nome dell'abbonamento è obbligatorio.");
		const prezzo = Number(rest.price);
		if (vuoto(rest.price) || !Number.isFinite(prezzo) || prezzo < 0) throw rifiuta('Il prezzo non è valido.');
		const durata = Number(rest.durata_valore);
		if (!Number.isInteger(durata) || durata < 1) throw rifiuta('La durata deve essere un numero intero maggiore di zero.');
		if (!unitaDurataValida(rest.durata_unita)) throw rifiuta('La durata va in giorni, mesi o anni.');
		rest.durata_valore = durata;
		if (vuoto(rest.vendibile_fino_al)) rest.vendibile_fino_al = null;
		else if (!/^\d{4}-\d{2}-\d{2}$/.test(rest.vendibile_fino_al)) throw rifiuta('La data massima di vendita non è valida.');
		else if (rest.vendibile_fino_al < oggiIso()) throw rifiuta('La data massima di vendita è già passata.');
		if (vuoto(rest.description)) rest.description = null;
		else if (String(rest.description).length > NOTE_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_MASSIMO} caratteri.`);
		rest.stato = 'attivo';
		return rest;
	},

	// Un'iscrizione si vende solo da un tipo vendibile, e la scadenza la calcola il server dalla
	// durata del tipo: mesi di calendario, non giorni contati nel browser.
	//
	// Prima valeva solo per le iscrizioni create con un tipo: senza `plan_id` passava qualunque
	// cosa, e in modifica non si controllava niente — si potevano spostare scadenza, socio e tipo
	// di un'iscrizione già venduta. Ora un'iscrizione nasce sempre da un tipo, e dopo si correggono
	// solo la data d'inizio (la scadenza segue, ricalcolata dal tipo) e l'importo pagato.
	// Lo stato non si scrive: si calcola dalle date a ogni lettura.
	async Subscription(body, { creazione, id }) {
		const { status: _calcolato, ...rest } = body ?? {};
		if (presente(rest, 'price_paid') && !vuoto(rest.price_paid)) {
			const importo = Number(rest.price_paid);
			if (!Number.isFinite(importo) || importo < 0) throw rifiuta("L'importo pagato non è valido.");
		}
		if (!creazione) {
			const campi = Object.keys(rest).filter((k) => !['start_date', 'price_paid', 'updated_date'].includes(k));
			if (campi.length) {
				throw rifiuta("Di un'iscrizione venduta si correggono solo la data d'inizio e l'importo pagato: per un altro tipo se ne vende una nuova.");
			}
			if (presente(rest, 'start_date')) {
				const [attuale] = await db
					.select({ durataValore: plans.durataValore, durataUnita: plans.durataUnita })
					.from(subscriptions)
					.innerJoin(plans, eq(subscriptions.planId, plans.id))
					.where(eq(subscriptions.id, id))
					.limit(1);
				if (!attuale) throw rifiuta("Quest'iscrizione non ha un tipo da cui ricalcolare la scadenza.");
				rest.end_date = dataFineAbbonamento(rest.start_date, attuale.durataValore, attuale.durataUnita);
				if (!rest.end_date) throw rifiuta("La data di inizio non è valida.");
			}
			rest.updated_date = new Date().toISOString();
			return rest;
		}
		if (vuoto(rest.member_id)) throw rifiuta('Manca il socio.');
		if (vuoto(rest.plan_id)) throw rifiuta("Scegli il tipo di abbonamento.");
		const [socio] = await db.select({ archiviatoIl: members.archiviatoIl }).from(members).where(eq(members.id, rest.member_id)).limit(1);
		if (socio?.archiviatoIl) throw rifiuta(SOCIO_ARCHIVIATO);
		const [tipo] = await db.select().from(plans).where(eq(plans.id, rest.plan_id)).limit(1);
		const motivo = motivoNonVendibile(tipo && { name: tipo.name, stato: tipo.stato, vendibile_fino_al: tipo.vendibileFinoAl });
		if (motivo) throw rifiuta(motivo);
		if (vuoto(rest.start_date)) rest.start_date = oggiIso();
		rest.end_date = dataFineAbbonamento(rest.start_date, tipo.durataValore, tipo.durataUnita);
		if (!rest.end_date) throw rifiuta("La data di inizio non è valida.");
		rest.plan_name = tipo.name;
		if (vuoto(rest.price_paid)) rest.price_paid = tipo.price;
		return rest;
	},

	// Tipo fra i tre ammessi, titolo per gli "altri", scadenza per quelli che scadono. In modifica
	// si controlla solo il tipo, se cambia: oggi i documenti si caricano e non si correggono.
	async MemberDocument(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (creazione) {
			const motivo = motivoDocumentoNonValido(rest);
			if (motivo) throw rifiuta(motivo);
		} else if (presente(rest, 'document_type') && !tipoDocumentoValido(rest.document_type)) {
			throw rifiuta('Tipo di documento non valido.');
		}
		return rest;
	},

	// Una sala: un nome, delle note corte, e uno stato fra attiva, sospesa e annullata. Sospesa è
	// sempre un periodo, da data a data — senza una fine nessuno saprebbe quando la stanza torna
	// libera. Negli altri due stati il periodo si cancella: restava scritto un pezzo di storia che
	// il resto del codice avrebbe continuato a leggere come una sospensione.
	//
	// La capienza non c'è più: quanta gente entra a lezione lo decide l'evento.
	async Room(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (creazione || presente(rest, 'name')) {
			rest.name = String(rest.name ?? '').trim();
			if (!rest.name) throw rifiuta('Il nome della sala è obbligatorio.');
			// Il limite è anche nella colonna, ma lì il rifiuto arriva come un generico "un testo
			// supera la lunghezza consentita", che non dice né quale né di quanto.
			if (rest.name.length > NOME_SALA_MASSIMO) throw rifiuta(`Il nome della sala sta in ${NOME_SALA_MASSIMO} caratteri.`);
		}
		if (presente(rest, 'description')) {
			if (vuoto(rest.description)) rest.description = null;
			else if (String(rest.description).length > NOTE_SALA_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_SALA_MASSIMO} caratteri.`);
		}
		if (creazione && !presente(rest, 'stato')) rest.stato = 'attivo';
		if (presente(rest, 'stato')) {
			if (!statoSalaValido(rest.stato)) throw rifiuta('Stato non valido: attiva, sospesa o annullata.');
			if (rest.stato === 'sospeso') {
				const motivo = motivoSospensioneNonValida(rest.sospesa_dal, rest.sospesa_al);
				if (motivo) throw rifiuta(motivo);
			} else {
				rest.sospesa_dal = null;
				rest.sospesa_al = null;
			}
		} else {
			// Date senza stato non vogliono dire niente, e il vincolo del database le rifiuterebbe
			// con un errore che non spiega nulla a chi ha compilato il modulo.
			delete rest.sospesa_dal;
			delete rest.sospesa_al;
		}
		return rest;
	},

	// Un evento non si programma in una sala annullata, né in una sospesa durante il suo periodo.
	// Il controllo sta sulla creazione: le sessioni nascono da qui (bulkCreate subito dopo),
	// quindi coprire il periodo dell'evento copre anche le sue lezioni, senza una query per
	// ognuna delle 104 possibili. Chi sposta poi una singola lezione passa da
	// `mutationBlockedReason`.
	async Event(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		// Un evento nuovo è una data singola o una regola settimanale: le date personalizzate non
		// si creano più. Quelli fatti così prima restano e si modificano.
		if ((creazione || presente(rest, 'recurrence_type')) && !RICORRENZE_CREABILI.includes(rest.recurrence_type)) {
			throw rifiuta('Un evento si ripete in una data singola o ogni settimana.');
		}
		if (creazione) {
			const motivo = await motivoEventoInSalaNonPrenotabile(rest);
			if (motivo) throw rifiuta(motivo);
		}
		// Un corso disattivato non si programma più: né un evento nuovo, né uno spostato su di lui.
		if ((creazione || presente(rest, 'course_id')) && !vuoto(rest.course_id)) {
			const [corso] = await db.select({ nome: courses.name, attivo: courses.attivo }).from(courses).where(eq(courses.id, rest.course_id)).limit(1);
			if (corso && !corso.attivo) throw rifiuta(`Il corso «${corso.nome}» è disattivato: riattivalo per programmarlo.`);
		}
		return rest;
	},

	// Un istruttore: nome e cognome (il nome completo lo calcola il database), codice fiscale
	// obbligatorio e scritto bene, partita IVA facoltativa ma scritta bene, note in tre righe.
	// Chi è stato registrato prima del codice fiscale obbligatorio lo completa alla prima
	// modifica che lo tocca; cambiare solo lo stato (attivo) non lo pretende.
	async Instructor(body, { creazione }) {
		const { full_name: _calcolato, ...rest } = body ?? {};
		for (const campo of ['nome', 'cognome']) {
			if (presente(rest, campo)) rest[campo] = String(rest[campo] ?? '').trim();
			if ((creazione || presente(rest, campo)) && vuoto(rest[campo])) {
				throw rifiuta(campo === 'nome' ? 'Il nome è obbligatorio.' : 'Il cognome è obbligatorio.');
			}
		}
		if (creazione || presente(rest, 'codice_fiscale')) {
			if (vuoto(rest.codice_fiscale)) throw rifiuta('Il codice fiscale è obbligatorio.');
			rest.codice_fiscale = normalizzaCodiceFiscale(rest.codice_fiscale);
			if (!codiceFiscaleValido(rest.codice_fiscale)) throw rifiuta('Il codice fiscale non è valido: controlla di averlo scritto bene.');
		}
		if (presente(rest, 'partita_iva')) {
			if (vuoto(rest.partita_iva)) rest.partita_iva = null;
			else {
				rest.partita_iva = normalizzaPartitaIva(rest.partita_iva);
				if (!partitaIvaValida(rest.partita_iva)) throw rifiuta('La partita IVA non è valida: sono undici cifre, controlla di averla scritta bene.');
			}
		}
		if (presente(rest, 'notes')) {
			if (vuoto(rest.notes)) rest.notes = null;
			else if (String(rest.notes).length > NOTE_ISTRUTTORE_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_ISTRUTTORE_MASSIMO} caratteri.`);
		}
		for (const campo of ['contact_email', 'contact_phone']) {
			if (presente(rest, campo) && vuoto(rest[campo])) rest[campo] = null;
		}
		return rest;
	},

	// Un corso si assegna solo a un istruttore attivo. Disattivare il corso, o cambiargli nome e
	// descrizione, non guarda l'istruttore: quello che conta è a chi lo si sta affidando adesso.
	async Course(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (presente(rest, 'disdetta_entro_ore')) {
			if (vuoto(rest.disdetta_entro_ore)) rest.disdetta_entro_ore = null;
			else {
				const ore = Number(rest.disdetta_entro_ore);
				if (!Number.isInteger(ore) || ore < 0 || ore > DISDETTA_MASSIMA_ORE) {
					throw rifiuta(`Il termine di disdetta va da 0 a ${DISDETTA_MASSIMA_ORE} ore.`);
				}
				rest.disdetta_entro_ore = ore;
			}
		}
		if (presente(rest, 'description')) {
			if (vuoto(rest.description)) rest.description = null;
			else if (String(rest.description).length > NOTE_CORSO_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_CORSO_MASSIMO} caratteri.`);
		}
		if ((creazione || presente(rest, 'instructor_id')) && !vuoto(rest.instructor_id)) {
			const [istruttore] = await db
				.select({ nome: instructors.fullName, attivo: instructors.attivo })
				.from(instructors)
				.where(eq(instructors.id, rest.instructor_id))
				.limit(1);
			if (istruttore && !istruttore.attivo) throw rifiuta(`«${istruttore.nome}» è disattivato: scegli un altro istruttore, o riattivalo.`);
		}
		return rest;
	},

	// Una lezione nasce in una sala e in un giorno: se la sala è annullata, o sospesa quel giorno,
	// non nasce. Il controllo sull'evento copre le lezioni generate dal modulo, ma `POST /Session`
	// e `/Session/bulk` passavano senza guardare la sala.
	async Session(body, { creazione }) {
		const rest = { ...(body ?? {}) };
		if (creazione) {
			const motivo = await motivoSalaNonDisponibile(rest.room_id, rest.date, rest.date);
			if (motivo) throw rifiuta(motivo);
		}
		return rest;
	},
};

/**
 * @param opzioni { creazione, utente, id } — alcune regole valgono solo quando la riga nasce,
 *                 altre dipendono da chi scrive e su quale riga.
 */
export async function applyWriteTransform(entityName, body, { creazione = true, utente = null, id = null } = {}) {
	const transform = WRITE_TRANSFORMS[entityName];
	return transform ? transform(body, { creazione, utente, id }) : body;
}

export function stripHiddenFields(entityName, row) {
	const hidden = HIDDEN_FIELDS[entityName];
	if (!hidden || !row) return row;
	const out = { ...row };
	for (const field of hidden) delete out[field];
	return out;
}

export function stripHiddenFieldsMany(entityName, rows) {
	const hidden = HIDDEN_FIELDS[entityName];
	if (!hidden) return rows;
	return rows.map((row) => stripHiddenFields(entityName, row));
}

/**
 * Campi che escono calcolati invece che letti dalla colonna.
 *
 * Lo stato di un'iscrizione dipende dalle date e nessun processo aggiorna la colonna: si
 * calcola qui, nel punto da cui passano tutte le letture, e così dashboard, elenchi, filtri e
 * scheda del socio si correggono insieme senza che nessuna schermata debba saperlo.
 *
 * Lo stesso per le date dopo le sospensioni (lib/iscrizioni.js): un'iscrizione sospesa esce con
 * la scadenza allungata e `giorni_sospesi`. Si calcolano su tutte le iscrizioni dei soci delle
 * righe, non solo su quelle chieste: una sospensione fa slittare anche il rinnovo che segue.
 */
const CAMPI_CALCOLATI = {
	async Subscription(righe) {
		const effettive = new Map();
		const perSocio = await iscrizioniPerSocio([...new Set(righe.map((r) => r.member_id).filter(Boolean))]);
		for (const elenco of perSocio.values()) for (const i of elenco) effettive.set(i.id, i);
		return righe.map((riga) => {
			const e = effettive.get(riga.id);
			const r = e ? { ...riga, start_date: e.start_date, end_date: e.end_date, giorni_sospesi: e.giorni_sospesi } : riga;
			return { ...r, status: statoIscrizione(r) };
		});
	},
};
const NOMI_CAMPI_CALCOLATI = { Subscription: ['status'] };

/** I campi di un'entità che escono calcolati: un filtro su questi non si fa sulla colonna. */
export const campiCalcolati = (entityName) => NOMI_CAMPI_CALCOLATI[entityName] ?? [];

export async function conCampiCalcolati(entityName, riga) {
	return riga ? (await conCampiCalcolatiMolte(entityName, [riga]))[0] : riga;
}

export async function conCampiCalcolatiMolte(entityName, righe) {
	const calcola = CAMPI_CALCOLATI[entityName];
	return calcola && Array.isArray(righe) && righe.length ? calcola(righe) : righe;
}

/**
 * Gli indirizzi dei file caricati escono firmati, e rientrano senza firma.
 *
 * `/uploads/*` non è più aperto a chiunque (vedi `lib/urlFirmati.js`): per aprire un file
 * serve una firma nell'indirizzo. Applicarla qui — nel punto unico da cui passano tutte le
 * letture delle entità — vuol dire che nessuna schermata deve saperlo: continua a mettere
 * `socio.foto_url` dentro un `<img src>` come ha sempre fatto.
 *
 * Il verso opposto conta quanto questo. Le schermate del gestionale rileggono l'indirizzo
 * di un'immagine, lo mettono in un campo del modulo e lo risalvano com'è: senza toglierla,
 * nel database finirebbe una firma, cioè un'immagine che smette di vedersi qualche ora dopo
 * senza che nessuno abbia toccato niente.
 */
const CAMPO_E_UN_FILE = /_url$/;

function mappaCampiFile(riga, come) {
	if (!riga || typeof riga !== 'object') return riga;
	let out = riga;
	for (const [campo, valore] of Object.entries(riga)) {
		if (!CAMPO_E_UN_FILE.test(campo) || typeof valore !== 'string') continue;
		const nuovo = come(valore);
		if (nuovo === valore) continue;
		if (out === riga) out = { ...riga };
		out[campo] = nuovo;
	}
	return out;
}

export function firmaFileInLettura(riga) {
	return mappaCampiFile(riga, firmaUrl);
}

export function firmaFileInLetturaMolte(righe) {
	return Array.isArray(righe) ? righe.map(firmaFileInLettura) : righe;
}

export function togliFirmaInScrittura(body) {
	return mappaCampiFile(body, togliFirma);
}

/**
 * Un campo che finisce in `_url` accetta solo un file caricato da noi.
 *
 * Il valore lo scrive il client e le schermate lo mettono dentro un `<a href>`: React non
 * blocca gli indirizzi `javascript:`, quindi chi poteva creare un documento scriveva
 * `file_url: "javascript:…"` e, al clic dell'amministratore sul nome del documento, lo script
 * girava nell'applicazione e si portava via il suo token. Ogni indirizzo di file che entra
 * dall'API è quindi un `/uploads/<nome>` — con o senza dominio davanti, come lo restituisce
 * `/api/uploads` — e nient'altro: niente `javascript:`, niente `data:`, niente percorsi annidati.
 *
 * L'estensione non si controlla qui: la decide già l'upload, e rifiutarla in scrittura
 * renderebbe non più salvabili le righe con un file caricato prima di quella regola.
 */
const FILE_CARICATO = /^(?:https?:\/\/[^/?#\s\\]+)?\/uploads\/[\w-][\w.-]*$/i;

export function verificaCampiFile(corpo) {
	if (!corpo || typeof corpo !== 'object') return;
	for (const [campo, valore] of Object.entries(corpo)) {
		if (!CAMPO_E_UN_FILE.test(campo) || valore === null || valore === undefined || valore === '') continue;
		if (typeof valore !== 'string' || !FILE_CARICATO.test(valore)) {
			throw rifiuta(`Indirizzo di file non valido nel campo ${campo}: si accettano solo file caricati.`);
		}
	}
}
