// Il motore dei segnali: chi va seguito oggi, e perché.
//
// Prima c'erano quattro motori di "attenzione", ognuno con le sue soglie: i rinnovi e i
// certificati della dashboard, il rischio degli ingressi, gli avvisi del portale, le condizioni
// dei lead. Qui ce n'è uno: tutte le schermate — Oggi, la dashboard, l'elenco dei soci, la
// scheda, il bancone — leggono quello che dice questo file.
//
// Niente si salva. La fase di una persona e i suoi segnali si calcolano dalle date ogni volta:
// un "in calo" salvato ieri oggi potrebbe essere falso. L'unica cosa scritta è il lavoro dello
// staff (il diario, `attivita`): un contatto registrato nasconde i segnali per qualche giorno,
// senza una tabella di compiti da tenere allineata.
//
// Il rischio si spiega in parole, non con un punteggio: "3 ingressi in 4 settimane contro 9 di
// media · scade tra 9 giorni · 2 no-show". Chi chiama deve sapere perché sta chiamando.
// ponytail: regole esplicite; un modello statistico solo quando ci saranno i dati di molte palestre.
import { oggiIso, oraIso, giorniFra, spostaGiorni, lezioneFinita } from './giorni.js';
import { abbonamentoCopre, sospensioneIl } from './abbonamenti.js';
import { avvisiSocio } from './avvisi.js';
import { conStatoDocumenti } from './anagrafica.js';
import { condizioniLead, descriviTempoLead, FILTRI_LEAD, SOGLIE_LEAD } from './lead.js';
import { SOGLIE } from './soglie.js';

/** Le fasi del rapporto con una persona, dal contatto all'ex socio. */
export const FASI = [
	{ valore: 'lead', etichetta: 'Contatto', tono: 'info' },
	{ valore: 'nuovo', etichetta: 'Nuovo', tono: 'info' },
	{ valore: 'ambientamento', etichetta: 'Ambientamento', tono: 'info' },
	{ valore: 'attivo', etichetta: 'Attivo', tono: 'positivo' },
	// L'abbonamento è fermo fino alla ripresa: non entra, non prenota, e non va cercato.
	{ valore: 'sospeso', etichetta: 'Sospeso', tono: 'neutro' },
	{ valore: 'in_calo', etichetta: 'In calo', tono: 'attesa' },
	{ valore: 'assente', etichetta: 'Assente', tono: 'attesa' },
	{ valore: 'in_scadenza', etichetta: 'In scadenza', tono: 'attesa' },
	{ valore: 'scaduto_recuperabile', etichetta: 'Scaduto, recuperabile', tono: 'negativo' },
	{ valore: 'ex_socio', etichetta: 'Ex socio', tono: 'neutro' },
];
const PER_FASE = Object.fromEntries(FASI.map((f) => [f.valore, f]));
export const fase = (v) => PER_FASE[v] ?? PER_FASE.attivo;

// I segnali per lo staff, dal più prezioso: tenere chi sta andando via vale più di tutto il
// resto. La priorità ordina la lista di Oggi.
const ETICHETTA_LEAD = Object.fromEntries(FILTRI_LEAD.map((f) => [f.valore, f.etichetta]));
export const SEGNALI = [
	// L'ha chiesto lui, dal portale: è il rinnovo più facile che ci sia, e non va lasciato aspettare.
	{ valore: 'rinnovo_richiesto', etichetta: 'Chiede di rinnovare', priorita: 100 },
	{ valore: 'scaduto_recuperabile', etichetta: 'Scaduto, da recuperare', priorita: 90 },
	{ valore: 'in_scadenza', etichetta: 'Abbonamento in scadenza', priorita: 80 },
	{ valore: 'assente', etichetta: 'Non viene da un po\'', priorita: 70 },
	{ valore: 'in_calo', etichetta: 'Viene meno di prima', priorita: 60 },
	{ valore: 'no_show_ripetuti', etichetta: 'Prenota e non viene', priorita: 55 },
	{ valore: 'richiami_oggi', etichetta: ETICHETTA_LEAD.richiami_oggi, priorita: 50 },
	{ valore: 'da_contattare', etichetta: ETICHETTA_LEAD.da_contattare, priorita: 50 },
	{ valore: 'ultimo_tentativo', etichetta: ETICHETTA_LEAD.ultimo_tentativo, priorita: 46 },
	{ valore: 'da_ricontattare', etichetta: ETICHETTA_LEAD.da_ricontattare, priorita: 45 },
	{ valore: 'conversazioni_ferme', etichetta: ETICHETTA_LEAD.conversazioni_ferme, priorita: 40 },
	{ valore: 'ambientamento_giorno_7', etichetta: 'Prima settimana: come va?', priorita: 35 },
	{ valore: 'ambientamento_pochi_ingressi', etichetta: 'Fatica a ingranare', priorita: 34 },
	{ valore: 'da_recuperare', etichetta: ETICHETTA_LEAD.da_recuperare, priorita: 30 },
	{ valore: 'certificato_scaduto', etichetta: 'Certificato medico scaduto', priorita: 25 },
	{ valore: 'certificato_in_scadenza', etichetta: 'Certificato medico in scadenza', priorita: 20 },
	{ valore: 'compleanno', etichetta: 'Compie gli anni', priorita: 10 },
];
// Quelli che servono solo al bancone, nel momento in cui la persona entra.
const SOLO_BANCONE = [
	{ valore: 'bentornato', etichetta: 'Bentornato', priorita: 40 },
	{ valore: 'traguardo', etichetta: 'Traguardo', priorita: 30 },
];
const PER_SEGNALE = Object.fromEntries([...SEGNALI, ...SOLO_BANCONE].map((s) => [s.valore, s]));
export const etichettaSegnale = (v) => PER_SEGNALE[v]?.etichetta ?? v;

// I segnali del lead sono le sue condizioni (shared/lead.js), tolte quelle che sono solo viste.
const CONDIZIONI_SEGNALE = new Set(['da_contattare', 'richiami_oggi', 'da_ricontattare', 'ultimo_tentativo', 'conversazioni_ferme', 'da_recuperare']);

/** I tipi di riga del diario che contano come "l'abbiamo cercato". */
export const TIPI_CONTATTO = ['contatto', 'tentativo', 'risposta'];

/** Di quanti giorni si può rimandare un segnale, al massimo. */
export const RIMANDO_MASSIMO_GIORNI = 60;

// Gli ingressi da cui una lezione conta come frequentata: dall'ora prima dell'inizio alla fine.
export const MINUTI_PRIMA_DELLA_LEZIONE = 60;
// Sotto questa media (ingressi in 4 settimane) un calo non dice niente: chi viene una volta al
// mese e salta un mese non sta andando via.
const MEDIA_MINIMA_PER_IL_CALO = 4;
// Quanti ingressi in 4 settimane servono a un nuovo socio per dire che ha ingranato.
const INGRESSI_AMBIENTAMENTO = 4;
// Quanti no-show nelle ultime 4 settimane fanno un segnale.
const NO_SHOW_SEGNALE = 2;
// Ogni quanti ingressi si festeggia al bancone.
const OGNI_TRAGUARDO = 50;

const minuti = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m; };

/**
 * Com'è andata una prenotazione confermata: `presente` se il socio è entrato da un'ora prima
 * dell'inizio alla fine della lezione, `no_show` se non è entrato e la lezione è finita,
 * `in_attesa` altrimenti. Si calcola, non si salva: un ingresso registrato dopo lo corregge.
 *
 * @param lezione  { data: 'AAAA-MM-GG', inizio: 'HH:MM', fine: 'HH:MM' }
 * @param ingressi gli istanti di ingresso del socio (Date o ISO)
 */
export function esitoPrenotazione(lezione, ingressi = [], adesso = new Date()) {
	const giorno = String(lezione.data).slice(0, 10);
	const da = minuti(lezione.inizio) - MINUTI_PRIMA_DELLA_LEZIONE;
	const a = minuti(lezione.fine);
	const entrato = ingressi.some((i) => {
		const t = new Date(i);
		if (oggiIso(t) !== giorno) return false;
		const m = minuti(oraIso(t));
		return m >= da && m <= a;
	});
	if (entrato) return 'presente';
	return lezioneFinita({ date: giorno, end_time: lezione.fine }, adesso) ? 'no_show' : 'in_attesa';
}

const giorno = (d) => (d ? String(d).slice(0, 10) : null);
const dataIt = (iso) => { const [a, m, g] = iso.split('-'); return `${g}/${m}/${a}`; };
const fra = (n) => (n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`);
const plurale = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;
const piuTardi = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Come sta l'abbonamento di un socio oggi.
 * - `valido`: un'iscrizione copre oggi; `rinnovato`: ce n'è una che parte dopo oggi;
 * - `fine`: l'ultimo giorno coperto da quella di oggi (null se senza fine);
 * - `scadenza`: la data più lontana fra quelle non ancora scadute, quella da mostrare;
 * - `ultimaFine`: l'ultima scadenza passata; `inizio`: da quando è socio senza interruzioni
 *   lunghe (un rinnovo fatto con qualche settimana di ritardo non lo fa tornare "nuovo");
 * - `sospensione`: quella in corso oggi (le iscrizioni passate da `conSospensioni`), o null;
 *   `ripresa`: il giorno in cui è finita l'ultima già finita, o null.
 */
export function coperturaAbbonamento(iscrizioni = [], oggi, soglie = SOGLIE.segnali) {
	const righe = iscrizioni.map((i) => ({ ...i, inizio: giorno(i.start_date), fine: giorno(i.end_date) }));
	const sospensione = sospensioneIl(righe, oggi);
	// Sospeso non vuol dire scaduto: l'iscrizione ferma conta come quella di oggi, ma non è valida.
	const diOggi = righe.filter((i) => abbonamentoCopre([i], oggi) || (sospensione && i.sospensioni?.includes(sospensione)));
	const valido = !sospensione && diOggi.length > 0;
	const rinnovato = righe.some((i) => i.inizio && i.inizio > oggi);
	const fine = diOggi.length ? (diOggi.some((i) => !i.fine) ? null : diOggi.map((i) => i.fine).sort().pop()) : null;
	const correnti = righe.filter((i) => !i.fine || i.fine >= oggi);
	const scadenza = correnti.some((i) => !i.fine) ? null : correnti.map((i) => i.fine).sort().pop() ?? null;
	const ultimaFine = righe.map((i) => i.fine).filter((f) => f && f < oggi).sort().pop() ?? null;
	const ripresa = righe.flatMap((i) => i.sospensioni ?? []).map((s) => spostaGiorni(s.al, 1)).filter((r) => r <= oggi).sort().pop() ?? null;
	// L'iscrizione di riferimento: quella di oggi che dura di più, o l'ultima finita.
	const riferimento = diOggi.length
		? [...diOggi].sort((a, b) => String(b.fine ?? '9999').localeCompare(String(a.fine ?? '9999')))[0]
		: righe.find((i) => i.fine === ultimaFine) ?? null;

	// Da quando, all'indietro, le iscrizioni si susseguono senza buchi più lunghi del "recuperabile".
	let inizio = righe.map((i) => i.inizio).filter((d) => d && d <= oggi).sort().pop() ?? null;
	for (let cambiato = Boolean(inizio); cambiato;) {
		cambiato = false;
		const limite = spostaGiorni(inizio, -soglie.recuperabileGiorni);
		for (const i of righe) {
			if (i.inizio && i.inizio < inizio && (!i.fine || i.fine >= limite)) { inizio = i.inizio; cambiato = true; }
		}
	}
	return { valido, rinnovato, fine, scadenza, ultimaFine, inizio, riferimento, sospensione, ripresa };
}

/**
 * Vera se la richiesta di rinnovo fatta dal portale aspetta ancora la reception: nessun
 * abbonamento venduto dopo, e nessun contatto riuscito dopo (un "non ha risposto" non conta: il
 * socio aspetta ancora). Le date sono istanti: richiesta e telefonata possono essere dello stesso giorno.
 *
 * @param richiesta      quando l'ha chiesto (Date o ISO), o null
 * @param ultimoContatto l'ultimo contatto riuscito (Date o ISO), o null
 * @param iscrizioni     [{ created_date }]
 */
export function richiestaRinnovoAperta(richiesta, { ultimoContatto = null, iscrizioni = [] } = {}) {
	if (!richiesta) return false;
	const il = new Date(richiesta).getTime();
	if (ultimoContatto && new Date(ultimoContatto).getTime() >= il) return false;
	return !iscrizioni.some((i) => i.created_date && new Date(i.created_date).getTime() >= il);
}

/** Vera se oggi è il compleanno di chi è nato in quel giorno (il 29 febbraio, il 28 negli anni normali). */
export function eCompleanno(nascita, oggi) {
	const md = giorno(nascita)?.slice(5);
	if (!md) return false;
	if (md === oggi.slice(5)) return true;
	return md === '02-29' && oggi.slice(5) === '02-28' && spostaGiorni(oggi, 1).slice(5) === '03-01';
}

/**
 * La fase e i segnali di una persona, oggi.
 *
 * @param p.socio        { created_date, archiviato_il, date_of_birth } | null (non è socio)
 * @param p.trattativa   la trattativa attuale (aperta, o l'ultima chiusa), come in shared/lead.js | null
 * @param p.iscrizioni   [{ id?, plan_name?, start_date, end_date }]
 * @param p.documenti    [{ id?, file_name?, document_type, created_date, expiry_date }]
 * @param p.ingressi     { ultimo: 'AAAA-MM-GG'|null, quattro, dodici, totale, prima?, oggi? } — ingressi
 *                       nelle ultime 4 e 12 settimane e in tutto; `prima` l'ultimo giorno di ingresso
 *                       prima di oggi, `oggi` quanti oggi (per i segnali del bancone di chi è già
 *                       entrato dal tornello). null se la palestra non li registra (senza
 *                       ingressi, tutti sembrerebbero assenti)
 * @param p.noShow       quante prenotazioni senza ingresso nelle ultime 4 settimane (esitoPrenotazione)
 * @param p.contatti     { ultimo: 'AAAA-MM-GG'|null, rimandatoAl: 'AAAA-MM-GG'|null, riscontro, richiestaRinnovo },
 *                       dal diario; gli ultimi due sono istanti: l'ultimo contatto riuscito e
 *                       l'ultima richiesta di rinnovo dal portale
 * @param p.iscrizioni   passate da `conSospensioni` (shared/abbonamenti.js), con `created_date`
 * @returns {{ fase, segnali: [{ codice, titolo, priorita, motivo, azioni, pubblico, nascostoFino, dati }], copertura }}
 *   `pubblico`: 'staff' (Oggi, la scheda), 'socio' (il portale), 'bancone' (chi entra adesso).
 *   `nascostoFino`: il segnale c'è ma non va riproposto prima di quel giorno; null se è da fare.
 */
export function segnaliPersona({
	socio = null, trattativa = null, iscrizioni = [], documenti = [], ingressi = null, noShow = 0,
	contatti = {}, oggi = oggiIso(), soglie: tutte = SOGLIE,
}) {
	const soglie = tutte.segnali ?? SOGLIE.segnali;
	const segnali = [];
	const aggiungi = (codice, motivo, extra = {}) => segnali.push({
		codice, titolo: etichettaSegnale(codice), priorita: PER_SEGNALE[codice]?.priorita ?? 0, motivo,
		azioni: ['chiama', 'whatsapp', 'email', 'contatto', 'rimanda'], pubblico: 'staff', nascostoFino: null, dati: null, ...extra,
	});

	// Chi non è socio: un contatto, con le condizioni della sua trattativa.
	if (!socio) {
		if (trattativa) {
			for (const c of condizioniLead(trattativa, oggi, tutte.lead ?? SOGLIE_LEAD)) {
				if (CONDIZIONI_SEGNALE.has(c)) aggiungi(c, descriviTempoLead(trattativa, oggi));
			}
		}
		return { fase: 'lead', segnali: nascondi(segnali, contatti, oggi, soglie, false), copertura: null };
	}

	const copertura = coperturaAbbonamento(iscrizioni, oggi, soglie);
	const inizio = copertura.inizio ?? giorno(socio.created_date) ?? oggi;
	const giorniSocio = giorniFra(inizio, oggi) ?? 0;
	const piano = copertura.riferimento?.plan_name;
	const datiAbbonamento = (giorni) => ({ iscrizione_id: copertura.riferimento?.id ?? null, abbonamento: piano ?? null, giorni });

	// La fase: una sola, la più urgente.
	let laFase;
	const giorniScaduto = copertura.ultimaFine ? giorniFra(copertura.ultimaFine, oggi) : null;
	const giorniAllaFine = copertura.fine ? giorniFra(oggi, copertura.fine) : null;
	const inScadenza = !socio.archiviato_il && copertura.valido && !copertura.rinnovato && giorniAllaFine !== null && giorniAllaFine <= tutte.abbonamentoInScadenzaGiorni;
	if (socio.archiviato_il) laFase = 'ex_socio';
	else if (copertura.sospensione) laFase = 'sospeso';
	else if (!copertura.valido && !copertura.rinnovato) {
		if (giorniScaduto !== null && giorniScaduto <= soglie.recuperabileGiorni) laFase = 'scaduto_recuperabile';
		// Appena iscritto, l'abbonamento ancora da fare: è nuovo, non ex.
		else if (giorniScaduto === null && giorniSocio <= soglie.nuovoGiorni) laFase = 'nuovo';
		else laFase = 'ex_socio';
	}
	const frequenta = !laFase;

	// Quanto viene: assenza e calo, solo se la palestra registra gli ingressi.
	let assente = false; let inCalo = false;
	if (frequenta && ingressi) {
		// I giorni di una sospensione non sono un'assenza: si conta dalla ripresa.
		const daQuando = piuTardi(piuTardi(giorno(ingressi.ultimo), inizio), copertura.ripresa);
		const giorniSenza = giorniFra(daQuando, oggi) ?? 0;
		if (giorniSenza >= soglie.assenzaGiorni) {
			assente = true;
			aggiungi('assente', ingressi.ultimo ? `non entra da ${giorniSenza} giorni` : `mai entrato in ${giorniSenza} giorni`, { dati: { giorni: giorniSenza } });
		}
		const media = (Number(ingressi.dodici) || 0) / 3;
		const quattro = Number(ingressi.quattro) || 0;
		// Dopo una ripresa le 4 e le 12 settimane contengono la sospensione: il confronto non dice niente.
		const ripresoDaPoco = copertura.ripresa && giorniFra(copertura.ripresa, oggi) < 84;
		if (!assente && !ripresoDaPoco && giorniSocio >= 84 && media >= MEDIA_MINIMA_PER_IL_CALO && quattro < (media * soglie.caloPercentuale) / 100) {
			inCalo = true;
			aggiungi('in_calo', `${plurale(quattro, 'ingresso', 'ingressi')} in 4 settimane contro ${Math.round(media)} di media`);
		}
	}

	if (!laFase) {
		if (inScadenza) laFase = 'in_scadenza';
		else if (assente) laFase = 'assente';
		else if (inCalo) laFase = 'in_calo';
		else if (giorniSocio <= soglie.nuovoGiorni) laFase = 'nuovo';
		else if (giorniSocio <= soglie.ambientamentoGiorni) laFase = 'ambientamento';
		else laFase = 'attivo';
	}

	// Chi chiede di rinnovare va richiamato in qualunque fase: anche un ex socio che vuole tornare.
	if (!socio.archiviato_il && richiestaRinnovoAperta(contatti.richiestaRinnovo, { ultimoContatto: contatti.riscontro, iscrizioni })) {
		const quando = giorniFra(oggiIso(new Date(contatti.richiestaRinnovo)), oggi);
		aggiungi('rinnovo_richiesto', `l'ha chiesto dal portale ${quando === 0 ? 'oggi' : quando === 1 ? 'ieri' : `${quando} giorni fa`}${piano ? ` (${piano})` : ''}`,
			{ dati: datiAbbonamento(null) });
	}
	if (laFase === 'scaduto_recuperabile') {
		aggiungi('scaduto_recuperabile', `scaduto da ${plurale(giorniScaduto, 'giorno', 'giorni')}${piano ? ` (${piano})` : ''}`, { dati: datiAbbonamento(-giorniScaduto) });
	}
	if (inScadenza) {
		aggiungi('in_scadenza', `scade ${fra(giorniAllaFine)}`, { dati: datiAbbonamento(giorniAllaFine) });
		aggiungi('in_scadenza', `Scade ${fra(giorniAllaFine)}: proponi il rinnovo`, { pubblico: 'bancone', azioni: ['proposta_rinnovo'] });
	}

	if (frequenta) {
		if (noShow >= NO_SHOW_SEGNALE) aggiungi('no_show_ripetuti', `${noShow} no-show in 4 settimane`, { dati: { no_show: noShow } });
		if (giorniSocio >= 7 && giorniSocio < 14) aggiungi('ambientamento_giorno_7', `iscritto da ${giorniSocio} giorni: come si trova?`, { dati: { giorni: giorniSocio } });
		if (ingressi && !assente && giorniSocio >= 21 && giorniSocio <= soglie.ambientamentoGiorni && (Number(ingressi.quattro) || 0) < INGRESSI_AMBIENTAMENTO) {
			aggiungi('ambientamento_pochi_ingressi', `${plurale(Number(ingressi.quattro) || 0, 'ingresso', 'ingressi')} in 4 settimane, iscritto da ${giorniSocio} giorni`);
		}

		// I certificati medici che contano ancora: lo stesso conto dei documenti (anagrafica.js).
		const certificati = conStatoDocumenti(documenti.filter((d) => d.document_type === 'certificato_medico'), (d) => (d ? giorniFra(oggi, giorno(d)) : null))
			.filter((d) => d.stato === 'scaduto' || d.stato === 'in_scadenza');
		if (certificati.length) {
			const d = certificati.sort((a, b) => a.giorni_alla_scadenza - b.giorni_alla_scadenza)[0];
			const scaduto = d.stato === 'scaduto';
			aggiungi(scaduto ? 'certificato_scaduto' : 'certificato_in_scadenza',
				scaduto ? `certificato scaduto il ${dataIt(giorno(d.expiry_date))}` : `certificato scade ${fra(d.giorni_alla_scadenza)}`,
				{ dati: { documento_id: d.id ?? null, file_name: d.file_name ?? null, giorni: d.giorni_alla_scadenza, scaduto } });
		}

		if (eCompleanno(socio.date_of_birth, oggi)) {
			aggiungi('compleanno', 'oggi compie gli anni');
			aggiungi('compleanno', 'Oggi compie gli anni: fagli gli auguri', { pubblico: 'bancone', azioni: ['saluto'] });
		}

		// Al bancone: chi torna dopo tanto, e i traguardi. Valgono prima di registrare l'ingresso
		// di oggi e anche dopo, per chi è già entrato dal tornello: si guarda a prima di oggi.
		const entratoOggi = Number(ingressi?.oggi ?? (giorno(ingressi?.ultimo) === oggi ? 1 : 0));
		const ultimoPrima = ingressi?.prima !== undefined ? giorno(ingressi.prima) : (entratoOggi ? null : giorno(ingressi?.ultimo));
		if (ultimoPrima) {
			const via = giorniFra(ultimoPrima, oggi);
			if (via >= soglie.assenzaGiorni) aggiungi('bentornato', `Bentornato: non veniva da ${via} giorni`, { pubblico: 'bancone', azioni: ['saluto'] });
		}
		const prossimo = (Number(ingressi?.totale) || 0) - entratoOggi + 1;
		if (ingressi && prossimo % OGNI_TRAGUARDO === 0) {
			aggiungi('traguardo', `Oggi è il suo ${prossimo}° ingresso!`, { pubblico: 'bancone', azioni: ['saluto'] });
		}
	}

	// Quello che vede il socio nel portale: gli avvisi di sempre (shared/avvisi.js).
	for (const a of avvisiSocio({ socio, iscrizioni, documenti, oggi })) {
		segnali.push({
			codice: a.codice, titolo: a.titolo, priorita: a.gravita === 'rosso' ? 90 : 50, motivo: a.testo,
			azioni: a.azione ? [a.azione] : [], pubblico: 'socio', nascostoFino: null, dati: null,
		});
	}

	return { fase: laFase, segnali: nascondi(segnali, contatti, oggi, soglie, true), copertura };
}

/**
 * Quando un segnale torna da fare. Un contatto lo nasconde per qualche giorno; un "rimanda"
 * fino al giorno scelto. I segnali del lead seguono la loro trattativa (un contatto ne cambia
 * lo stato), quindi li nasconde solo il rimando. Al bancone un saluto basta per oggi; il
 * rinnovo proposto vale come un contatto.
 */
function nascondi(segnali, { ultimo = null, rimandatoAl = null } = {}, oggi, soglie, socio) {
	const dopoContatto = ultimo ? spostaGiorni(giorno(ultimo), soglie.contattoNascondeGiorni) : null;
	return segnali.map((s) => {
		let fino = null;
		// La richiesta di rinnovo la chiude il contatto stesso (richiestaRinnovoAperta): un
		// contatto di prima, per un'altra ragione, non deve nasconderla.
		if (s.codice === 'rinnovo_richiesto') fino = null;
		else if (s.pubblico === 'staff') fino = socio ? piuTardi(dopoContatto, giorno(rimandatoAl)) : giorno(rimandatoAl);
		if (s.pubblico === 'bancone') fino = s.codice === 'in_scadenza' ? dopoContatto : (ultimo ? spostaGiorni(giorno(ultimo), 1) : null);
		return { ...s, nascostoFino: fino && fino > oggi ? fino : null };
	});
}

/** I segnali da fare adesso per un pubblico, dal più prezioso. */
export function daFare(segnali = [], pubblico = 'staff') {
	return segnali.filter((s) => s.pubblico === pubblico && !s.nascostoFino).sort((a, b) => b.priorita - a.priorita);
}

/** Il perché, in una riga: "3 ingressi in 4 settimane contro 9 di media · scade tra 9 giorni · 2 no-show". */
export function perche(segnali = []) {
	return segnali.map((s) => s.motivo).filter(Boolean).join(' · ');
}

/** Il testo già scritto per WhatsApp, a seconda del segnale principale. */
export function testoMessaggio(nome, codice) {
	const ciao = `Ciao ${nome}!`;
	switch (codice) {
		case 'rinnovo_richiesto': return `${ciao} Abbiamo ricevuto la tua richiesta di rinnovo: quando passi in reception lo sistemiamo.`;
		case 'in_scadenza': return `${ciao} Il tuo abbonamento sta per scadere: passa in reception per rinnovarlo.`;
		case 'scaduto_recuperabile': return `${ciao} Ci manchi in palestra: ti va di ripartire? Passa a trovarci.`;
		case 'assente': case 'in_calo': return `${ciao} È un po' che non ti vediamo: va tutto bene?`;
		case 'compleanno': return `${ciao} Tanti auguri di buon compleanno da tutta la palestra!`;
		default: return ciao;
	}
}
