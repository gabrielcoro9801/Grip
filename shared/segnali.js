// Il motore dei segnali: chi va seguito oggi, e perché.
//
// Prima c'erano quattro motori di "attenzione", ognuno con le sue soglie: i rinnovi e i
// certificati della dashboard, il rischio degli ingressi, gli avvisi del portale, le condizioni
// dei lead. Qui ce n'è uno: tutte le schermate — Da fare, la dashboard, l'elenco dei soci, la
// scheda, il bancone — leggono quello che dice questo file.
//
// Niente si salva. Lo stato di una persona e i suoi segnali si calcolano dalle date ogni volta:
// un "in calo" salvato ieri oggi potrebbe essere falso. L'unica cosa scritta è il lavoro dello
// staff (il diario, `attivita`): un "Fatto" nasconde per qualche giorno il segnale per cui è
// stato fatto, senza una tabella di compiti da tenere allineata. La palestra sceglie quali
// segnali seguire e con quali soglie (Impostazioni › Da fare, shared/soglie.js).
//
// Il rischio si spiega in parole, non con un punteggio: "3 ingressi in 4 settimane contro 9 di
// media · scade tra 9 giorni · 2 no-show". Chi chiama deve sapere perché sta chiamando.
// ponytail: regole esplicite; un modello statistico solo quando ci saranno i dati di molte palestre.
import { oggiIso, oraIso, giorniFra, spostaGiorni, lezioneFinita } from './giorni.js';
import { abbonamentoCopre, sospensioneIl } from './abbonamenti.js';
import { avvisiSocio, documentiDaSistemare } from './avvisi.js';
import { condizioniLead, descriviTempoLead, FILTRI_LEAD, SOGLIE_LEAD } from './lead.js';
import { SOGLIE } from './soglie.js';

/**
 * Lo stato di una persona: per un socio, il suo rapporto con la palestra. Sei valori, e solo
 * quelli: l'abbonamento (in scadenza, scaduto) ha la sua colonna, e il lavoro da fare (rinnovi,
 * documenti, ambientamento) sta nei segnali. Mescolarli faceva undici "fasi" che dicevano tre
 * cose diverse. `lead` non è uno stato del socio: è chi non lo è ancora.
 */
export const FASI = [
	{ valore: 'lead', etichetta: 'Contatto', tono: 'info' },
	{ valore: 'nuovo', etichetta: 'Nuovo', tono: 'info' },
	{ valore: 'attivo', etichetta: 'Attivo', tono: 'positivo' },
	{ valore: 'in_calo', etichetta: 'In calo', tono: 'attesa' },
	{ valore: 'senza_abbonamento', etichetta: 'Senza abbonamento', tono: 'negativo' },
	// L'abbonamento è fermo fino alla ripresa: non entra, non prenota, e non va cercato.
	{ valore: 'sospeso', etichetta: 'Sospeso', tono: 'neutro' },
	{ valore: 'archiviato', etichetta: 'Archiviato', tono: 'neutro' },
];
const PER_FASE = Object.fromEntries(FASI.map((f) => [f.valore, f]));
export const fase = (v) => PER_FASE[v] ?? PER_FASE.attivo;

// Quando vale uno stato, in parole, con le soglie della palestra: la legenda dell'elenco soci.
// Si valutano in quest'ordine, e vince il primo che vale (segnaliPersona).
const REGOLE_FASI = {
	archiviato: () => 'ha lasciato la palestra: archiviato a mano («Non torna») o in automatico',
	sospeso: () => 'una sospensione dell\'abbonamento copre oggi',
	senza_abbonamento: (s) => `nessun abbonamento valido oggi né già comprato per dopo; ${s.segnali.archiviazioneGiorni
		? `dopo ${s.segnali.archiviazioneGiorni} giorni così viene archiviato in automatico` : 'non viene mai archiviato in automatico'}`,
	nuovo: (s) => `abbonamento valido, socio da non più di ${s.segnali.nuovoGiorni} giorni`,
	in_calo: (s) => `abbonamento valido, socio da più di ${s.segnali.nuovoGiorni} giorni, e non entra da ${s.segnali.assenzaGiorni} giorni o viene meno del ${s.segnali.caloPercentuale}% della sua media`,
	attivo: (s) => `abbonamento valido, socio da più di ${s.segnali.nuovoGiorni} giorni, viene con regolarità`,
	lead: () => 'non è ancora socio: è un contatto',
};
/** Gli stati dei soci nell'ordine in cui si valutano: [{ valore, etichetta, tono, regola }]. */
export const regoleStati = (soglie = SOGLIE) => ['archiviato', 'sospeso', 'senza_abbonamento', 'nuovo', 'in_calo', 'attivo']
	.map((v) => ({ ...PER_FASE[v], regola: REGOLE_FASI[v]({ ...soglie, segnali: { ...SOGLIE.segnali, ...soglie.segnali } }) }));

// I segnali per lo staff, dal più prezioso: tenere chi sta andando via vale più di tutto il
// resto. La priorità ordina la lista di Da fare. `regola` dice in parole quando scatta, con le
// soglie della palestra: la leggono le Impostazioni e il "perché" di Da fare.
const ETICHETTA_LEAD = Object.fromEntries(FILTRI_LEAD.map((f) => [f.valore, f.etichetta]));
const REGOLA_LEAD = 'dalle condizioni della trattativa (pagina Contatti)';
export const SEGNALI = [
	// L'ha chiesto lui, dal portale: è il rinnovo più facile che ci sia, e non va lasciato aspettare.
	{ valore: 'rinnovo_richiesto', etichetta: 'Chiede di rinnovare', priorita: 100, regola: () => 'ha chiesto il rinnovo dal portale e nessuno gli ha ancora risposto' },
	{ valore: 'scaduto_recuperabile', etichetta: 'Scaduto, da recuperare', priorita: 90, regola: (s) => `abbonamento scaduto da non più di ${s.segnali.recuperabileGiorni} giorni, senza rinnovo` },
	{ valore: 'in_scadenza', etichetta: 'Abbonamento in scadenza', priorita: 80, regola: (s) => `l'abbonamento finisce entro ${s.abbonamentoInScadenzaGiorni} giorni e non ha ancora rinnovato` },
	{ valore: 'assente', etichetta: 'Non viene da un po\'', priorita: 70, regola: (s) => `nessun ingresso da ${s.segnali.assenzaGiorni} giorni` },
	{ valore: 'in_calo', etichetta: 'Viene meno di prima', priorita: 60, regola: (s) => `nelle ultime 4 settimane meno del ${s.segnali.caloPercentuale}% della sua media (se viene almeno ${s.segnali.mediaMinimaCalo} volte ogni 4 settimane)` },
	{ valore: 'no_show_ripetuti', etichetta: 'Prenota e non viene', priorita: 55, regola: (s) => `almeno ${s.segnali.noShowSegnale} prenotazioni senza ingresso nelle ultime 4 settimane` },
	{ valore: 'richiami_oggi', etichetta: ETICHETTA_LEAD.richiami_oggi, priorita: 50, regola: () => REGOLA_LEAD },
	{ valore: 'da_contattare', etichetta: ETICHETTA_LEAD.da_contattare, priorita: 50, regola: () => REGOLA_LEAD },
	{ valore: 'ultimo_tentativo', etichetta: ETICHETTA_LEAD.ultimo_tentativo, priorita: 46, regola: () => REGOLA_LEAD },
	{ valore: 'da_ricontattare', etichetta: ETICHETTA_LEAD.da_ricontattare, priorita: 45, regola: () => REGOLA_LEAD },
	{ valore: 'conversazioni_ferme', etichetta: ETICHETTA_LEAD.conversazioni_ferme, priorita: 40, regola: () => REGOLA_LEAD },
	{ valore: 'ambientamento_giorno_7', etichetta: 'Prima settimana: come va?', priorita: 35, regola: (s) => `iscritto da ${s.segnali.primoControlloGiorni} giorni (per una settimana)` },
	{ valore: 'ambientamento_pochi_ingressi', etichetta: 'Fatica a ingranare', priorita: 34, regola: (s) => `iscritto da 3 settimane a ${s.segnali.ambientamentoGiorni} giorni, meno di ${s.segnali.ingressiAmbientamento} ingressi in 4 settimane` },
	{ valore: 'da_recuperare', etichetta: ETICHETTA_LEAD.da_recuperare, priorita: 30, regola: () => REGOLA_LEAD },
	{ valore: 'documento_scaduto', etichetta: 'Documento scaduto', priorita: 26, regola: () => 'un documento obbligatorio è scaduto e non è stato sostituito' },
	{ valore: 'documento_mancante', etichetta: 'Documento mancante', priorita: 25, regola: () => 'manca un documento obbligatorio (certificato, documento di identità, consenso dei genitori per i minorenni)' },
	{ valore: 'documento_in_scadenza', etichetta: 'Documento in scadenza', priorita: 20, regola: (s) => `un documento obbligatorio scade entro ${s.documentoInScadenzaGiorni} giorni` },
	{ valore: 'compleanno', etichetta: 'Compie gli anni', priorita: 10, regola: () => 'oggi è il suo compleanno' },
];
// Quelli che servono solo al bancone, nel momento in cui la persona entra.
const SOLO_BANCONE = [
	{ valore: 'bentornato', etichetta: 'Bentornato', priorita: 40, regola: (s) => `entra dopo ${s.segnali.assenzaGiorni} giorni o più senza ingressi` },
	{ valore: 'traguardo', etichetta: 'Traguardo', priorita: 30, regola: (s) => `ogni ${s.segnali.ogniTraguardo} ingressi` },
];
const PER_SEGNALE = Object.fromEntries([...SEGNALI, ...SOLO_BANCONE].map((s) => [s.valore, s]));
export const etichettaSegnale = (v) => PER_SEGNALE[v]?.etichetta ?? v;
/** Quando scatta un segnale, in parole, con le soglie della palestra (soglieDi). */
export const regolaSegnale = (v, soglie = SOGLIE) => PER_SEGNALE[v]?.regola?.(soglie) ?? '';

/**
 * Le linee di Da fare: i segnali raggruppati per il lavoro che chiedono. Ognuna si risolve a modo
 * suo — un rinnovo con l'abbonamento, un documento caricandolo, gli altri con un "Fatto" — e la
 * palestra può spegnere i segnali che non segue (Impostazioni › Da fare). Il bancone ha i suoi.
 */
export const LINEE = [
	{ valore: 'rinnovi', etichetta: 'Rinnovi', segnali: ['rinnovo_richiesto', 'in_scadenza', 'scaduto_recuperabile'] },
	{ valore: 'frequenza', etichetta: 'Chi non viene', segnali: ['assente', 'in_calo', 'no_show_ripetuti'] },
	{ valore: 'nuovi', etichetta: 'Nuovi soci', segnali: ['ambientamento_giorno_7', 'ambientamento_pochi_ingressi'] },
	{ valore: 'documenti', etichetta: 'Documenti', segnali: ['documento_scaduto', 'documento_mancante', 'documento_in_scadenza'] },
	{ valore: 'compleanni', etichetta: 'Compleanni', segnali: ['compleanno'] },
	{ valore: 'contatti', etichetta: 'Contatti', segnali: ['richiami_oggi', 'da_contattare', 'ultimo_tentativo', 'da_ricontattare', 'conversazioni_ferme', 'da_recuperare'] },
	{ valore: 'bancone', etichetta: 'Al bancone', segnali: ['bentornato', 'traguardo'], soloImpostazioni: true },
];
const LINEA_DI = Object.fromEntries(LINEE.flatMap((l) => l.segnali.map((c) => [c, l.valore])));
export const lineaDi = (codice) => LINEA_DI[codice] ?? null;
/** Tutti i codici che la palestra può spegnere. */
export const CODICI_SEGNALE = Object.keys(PER_SEGNALE);

// I segnali del lead sono le sue condizioni (shared/lead.js), tolte quelle che sono solo viste.
const CONDIZIONI_SEGNALE = new Set(['da_contattare', 'richiami_oggi', 'da_ricontattare', 'ultimo_tentativo', 'conversazioni_ferme', 'da_recuperare']);

/** I tipi di riga del diario che contano come "l'abbiamo cercato". */
export const TIPI_CONTATTO = ['contatto', 'tentativo', 'risposta'];

// Gli ingressi da cui una lezione conta come frequentata: dall'ora prima dell'inizio alla fine.
export const MINUTI_PRIMA_DELLA_LEZIONE = 60;
// Quanta storia serve per parlare di calo: la media si fa su 12 settimane, e un socio più giovane
// (o ripreso da una sospensione più di recente) non ce l'ha. Non è una scelta della palestra.
const GIORNI_STORIA_PER_IL_CALO = 84;

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
 * Lo stato e i segnali di una persona, oggi.
 *
 * @param p.socio        { created_date, archiviato_il, date_of_birth } | null (non è socio)
 * @param p.trattativa   la trattativa attuale (aperta, o l'ultima chiusa), come in shared/lead.js | null
 * @param p.iscrizioni   [{ id?, plan_name?, start_date, end_date }], passate da `conSospensioni`
 *                       (shared/abbonamenti.js), con `created_date`
 * @param p.documenti    [{ id?, file_name?, document_type, created_date, expiry_date }]
 * @param p.ingressi     { ultimo: 'AAAA-MM-GG'|null, quattro, dodici, totale, prima?, oggi? } — ingressi
 *                       nelle ultime 4 e 12 settimane e in tutto; `prima` l'ultimo giorno di ingresso
 *                       prima di oggi, `oggi` quanti oggi (per i segnali del bancone di chi è già
 *                       entrato dal tornello). null se la palestra non li registra (senza
 *                       ingressi, tutti sembrerebbero assenti)
 * @param p.noShow       quante prenotazioni senza ingresso nelle ultime 4 settimane (esitoPrenotazione)
 * @param p.contatti     { perSegnale: { [codice]: 'AAAA-MM-GG' }, riscontro, richiestaRinnovo }, dal
 *                       diario: l'ultimo "Fatto" per ogni segnale; gli altri due sono istanti,
 *                       l'ultimo contatto riuscito e l'ultima richiesta di rinnovo dal portale
 * @param p.soglie       quelle della palestra (soglieDi), con `segnaliSpenti`
 * @returns {{ fase, segnali: [{ codice, titolo, priorita, motivo, azioni, pubblico, nascostoFino, dati }], copertura }}
 *   `fase`: lo stato (FASI). `pubblico`: 'staff' (Da fare), 'socio' (il portale), 'bancone' (chi
 *   entra adesso). `nascostoFino`: il segnale c'è ma non va riproposto prima di quel giorno.
 */
export function segnaliPersona({
	socio = null, trattativa = null, iscrizioni = [], documenti = [], ingressi = null, noShow = 0,
	contatti = {}, oggi = oggiIso(), soglie: tutte = SOGLIE,
}) {
	const soglie = { ...SOGLIE.segnali, ...(tutte.segnali ?? {}) };
	const spenti = new Set(tutte.segnaliSpenti ?? []);
	const segnali = [];
	// Un segnale spento dalla palestra non si calcola: non compare da nessuna parte, e nessun
	// playbook parte per lui. Lo stato invece sì: "In calo" resta vero anche se nessuno lo segue.
	const aggiungi = (codice, motivo, extra = {}) => {
		if (spenti.has(codice)) return;
		segnali.push({
			codice, titolo: etichettaSegnale(codice), priorita: PER_SEGNALE[codice]?.priorita ?? 0, motivo,
			azioni: ['chiama', 'whatsapp', 'email', 'fatto'], pubblico: 'staff', nascostoFino: null, dati: null, ...extra,
		});
	};

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
	const giorniScaduto = copertura.ultimaFine ? giorniFra(copertura.ultimaFine, oggi) : null;
	const giorniAllaFine = copertura.fine ? giorniFra(oggi, copertura.fine) : null;
	const archiviato = Boolean(socio.archiviato_il);
	const senzaAbbonamento = !copertura.valido && !copertura.rinnovato;
	// Frequenta chi ha un abbonamento (anche già comprato per dopo un buco) e non è fermo.
	const frequenta = !archiviato && !copertura.sospensione && !senzaAbbonamento;
	const inScadenza = frequenta && copertura.valido && !copertura.rinnovato && giorniAllaFine !== null && giorniAllaFine <= tutte.abbonamentoInScadenzaGiorni;

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
		const ripresoDaPoco = copertura.ripresa && giorniFra(copertura.ripresa, oggi) < GIORNI_STORIA_PER_IL_CALO;
		if (!assente && !ripresoDaPoco && giorniSocio >= GIORNI_STORIA_PER_IL_CALO && media >= soglie.mediaMinimaCalo && quattro < (media * soglie.caloPercentuale) / 100) {
			inCalo = true;
			aggiungi('in_calo', `${plurale(quattro, 'ingresso', 'ingressi')} in 4 settimane contro ${Math.round(media)} di media`);
		}
	}

	// Lo stato: uno solo, il primo che vale. Abbonamento e lavoro da fare non sono stati: stanno
	// nella colonna dell'abbonamento e nei segnali. "Assente" è la forma grave di "In calo".
	let laFase;
	if (archiviato) laFase = 'archiviato';
	else if (copertura.sospensione) laFase = 'sospeso';
	else if (senzaAbbonamento) laFase = 'senza_abbonamento';
	else if (giorniSocio <= soglie.nuovoGiorni) laFase = 'nuovo';
	else if (assente || inCalo) laFase = 'in_calo';
	else laFase = 'attivo';

	// Chi chiede di rinnovare va richiamato in qualunque stato: anche uno scaduto da tanto che vuole tornare.
	if (!archiviato && richiestaRinnovoAperta(contatti.richiestaRinnovo, { ultimoContatto: contatti.riscontro, iscrizioni })) {
		const quando = giorniFra(oggiIso(new Date(contatti.richiestaRinnovo)), oggi);
		aggiungi('rinnovo_richiesto', `l'ha chiesto dal portale ${quando === 0 ? 'oggi' : quando === 1 ? 'ieri' : `${quando} giorni fa`}${piano ? ` (${piano})` : ''}`,
			{ dati: datiAbbonamento(null) });
	}
	if (!archiviato && !copertura.sospensione && senzaAbbonamento && giorniScaduto !== null && giorniScaduto <= soglie.recuperabileGiorni) {
		aggiungi('scaduto_recuperabile', `scaduto da ${plurale(giorniScaduto, 'giorno', 'giorni')}${piano ? ` (${piano})` : ''}`, { dati: datiAbbonamento(-giorniScaduto) });
	}
	if (inScadenza) {
		aggiungi('in_scadenza', `scade ${fra(giorniAllaFine)}`, { dati: datiAbbonamento(giorniAllaFine) });
		aggiungi('in_scadenza', `Scade ${fra(giorniAllaFine)}: proponi il rinnovo`, { pubblico: 'bancone', azioni: ['proposta_rinnovo'] });
	}

	if (frequenta) {
		if (noShow >= soglie.noShowSegnale) aggiungi('no_show_ripetuti', `${noShow} no-show in 4 settimane`, { dati: { no_show: noShow } });
		if (giorniSocio >= soglie.primoControlloGiorni && giorniSocio < soglie.primoControlloGiorni + 7) {
			aggiungi('ambientamento_giorno_7', `iscritto da ${giorniSocio} giorni: come si trova?`, { dati: { giorni: giorniSocio } });
		}
		if (ingressi && !assente && giorniSocio >= 21 && giorniSocio <= soglie.ambientamentoGiorni && (Number(ingressi.quattro) || 0) < soglie.ingressiAmbientamento) {
			aggiungi('ambientamento_pochi_ingressi', `${plurale(Number(ingressi.quattro) || 0, 'ingresso', 'ingressi')} in 4 settimane, iscritto da ${giorniSocio} giorni`);
		}

		// I documenti obbligatori fuori regola: la stessa regola del portale e degli ingressi
		// (documentiDaSistemare). Un segnale per genere di problema, con tutti i documenti dentro.
		const fuori = documentiDaSistemare({ socio, documenti, oggi, giorniInScadenza: tutte.documentoInScadenzaGiorni });
		const descrivi = {
			mancante: (d) => `manca ${d.nome.toLowerCase()}`,
			scaduto: (d) => `${d.nome.toLowerCase()} scaduto${d.scadenza ? ` il ${dataIt(d.scadenza)}` : ''}`,
			in_scadenza: (d) => `${d.nome.toLowerCase()} scade ${fra(d.giorni)}`,
		};
		for (const stato of ['scaduto', 'mancante', 'in_scadenza']) {
			const questi = fuori.filter((d) => d.stato === stato);
			if (questi.length) aggiungi(`documento_${stato}`, questi.map(descrivi[stato]).join(', '), { dati: { documenti: questi } });
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
		if (ingressi && prossimo % soglie.ogniTraguardo === 0) {
			aggiungi('traguardo', `Oggi è il suo ${prossimo}° ingresso!`, { pubblico: 'bancone', azioni: ['saluto'] });
		}
	}

	// Quello che vede il socio nel portale: gli avvisi di sempre (shared/avvisi.js).
	for (const a of avvisiSocio({ socio, iscrizioni, documenti, oggi, soglie: tutte })) {
		segnali.push({
			codice: a.codice, titolo: a.titolo, priorita: a.gravita === 'rosso' ? 90 : 50, motivo: a.testo,
			azioni: a.azione ? [a.azione] : [], pubblico: 'socio', nascostoFino: null, dati: null,
		});
	}

	return { fase: laFase, segnali: nascondi(segnali, contatti, oggi, soglie, true), copertura };
}

/**
 * Quando un segnale torna da fare. Un "Fatto" nasconde **solo il segnale per cui è stato fatto**,
 * per qualche giorno: chiamato perché non viene, il certificato scaduto resta in Documenti. I
 * segnali del lead seguono la loro trattativa (un contatto ne cambia lo stato): non si nascondono.
 * Al bancone un saluto basta per oggi; il rinnovo proposto vale come un Fatto sul rinnovo.
 */
function nascondi(segnali, { perSegnale = {} } = {}, oggi, soglie, socio) {
	return segnali.map((s) => {
		const il = perSegnale?.[s.codice] ? giorno(perSegnale[s.codice]) : null;
		let fino = null;
		// La richiesta di rinnovo la chiude il contatto riuscito (richiestaRinnovoAperta).
		if (s.codice === 'rinnovo_richiesto' || !il) fino = null;
		else if (s.pubblico === 'staff') fino = socio ? spostaGiorni(il, soglie.contattoNascondeGiorni) : null;
		else if (s.pubblico === 'bancone') fino = spostaGiorni(il, s.codice === 'in_scadenza' ? soglie.contattoNascondeGiorni : 1);
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
