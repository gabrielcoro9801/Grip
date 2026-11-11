// Il motore dei segnali: chi va seguito oggi, e perché.
//
// Prima c'erano quattro motori di "attenzione", ognuno con le sue soglie: i rinnovi e i
// certificati della dashboard, il rischio degli ingressi, gli avvisi del portale, le condizioni
// dei lead. Qui ce n'è uno: Da fare, la dashboard, l'elenco dei soci, la scheda e il bancone
// leggono quello che dice questo file. I contatti (lead) hanno la loro sezione, con le condizioni
// di shared/lead.js: qui non entrano.
//
// Lo stato di una persona e i suoi segnali si calcolano dalle date ogni volta: un "in calo"
// salvato ieri oggi potrebbe essere falso. Da fare trasforma i segnali per lo staff in avvisi,
// ognuno con la sua chiave (shared/daFare.js), e il server tiene quelli aperti e chiusi in una
// tabella. La palestra sceglie quali segnali seguire e con quali soglie (shared/soglie.js).
//
// Il rischio si spiega in parole, non con un punteggio: "3 ingressi in 4 settimane contro 9 di
// media · scade tra 9 giorni". Chi chiama deve sapere perché sta chiamando.
// ponytail: regole esplicite; un modello statistico solo quando ci saranno i dati di molte palestre.
import { oggiIso, oraIso, giorniFra, spostaGiorni, lezioneFinita } from './giorni.js';
import { abbonamentoCopre, sospensioneIl } from './abbonamenti.js';
import { avvisiSocio, documentiDaSistemare } from './avvisi.js';
import { SOGLIE } from './soglie.js';

/**
 * Lo stato di una persona: per un socio, il suo rapporto con la palestra. Sei valori, e solo
 * quelli: l'abbonamento (in scadenza, scaduto) ha la sua colonna, e il lavoro da fare (rinnovi,
 * documenti) sta nei segnali. Mescolarli faceva undici "fasi" che dicevano tre cose diverse.
 * `lead` non è uno stato del socio: è chi non lo è ancora.
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

const plurale = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;

// La finestra del compleanno, in parole: "da 3 giorni prima a 3 giorni dopo".
function finestraCompleanno(s) {
	const prima = s.compleannoPrimaGiorni ?? SOGLIE.compleannoPrimaGiorni;
	const dopo = s.compleannoDopoGiorni ?? SOGLIE.compleannoDopoGiorni;
	if (!prima && !dopo) return 'oggi è il suo compleanno';
	const da = prima ? `da ${plurale(prima, 'giorno', 'giorni')} prima` : 'dal giorno stesso';
	const a = dopo ? `a ${plurale(dopo, 'giorno', 'giorni')} dopo` : 'al giorno stesso';
	return `si avvicina o è appena passato il suo compleanno: ${da} ${a}`;
}

// I segnali per lo staff, dal più prezioso: tenere chi sta andando via vale più di tutto il
// resto. `regola` dice in parole quando scatta, con le soglie della palestra.
export const SEGNALI = [
	{ valore: 'scaduto', etichetta: 'Abbonamento scaduto', priorita: 90, regola: (s) => `abbonamento scaduto da non più di ${s.scadutoGiorni ?? SOGLIE.scadutoGiorni} giorni, senza rinnovo` },
	{ valore: 'in_scadenza', etichetta: 'Abbonamento in scadenza', priorita: 80, regola: (s) => `l'abbonamento finisce entro ${s.abbonamentoInScadenzaGiorni} giorni e non ha ancora rinnovato` },
	{ valore: 'assente', etichetta: 'Non viene da un po\'', priorita: 70, regola: (s) => `nessun ingresso da ${s.segnali.assenzaGiorni} giorni` },
	{ valore: 'in_calo', etichetta: 'Viene meno di prima', priorita: 60, regola: (s) => `nelle ultime 4 settimane meno del ${s.segnali.caloPercentuale}% della sua media (se viene almeno ${s.segnali.mediaMinimaCalo} volte ogni 4 settimane)` },
	{ valore: 'documento_scaduto', etichetta: 'Documento scaduto', priorita: 26, regola: () => 'un documento obbligatorio è scaduto e non è stato sostituito' },
	{ valore: 'documento_in_scadenza', etichetta: 'Documento in scadenza', priorita: 20, regola: (s) => `un documento obbligatorio scade entro ${s.documentoInScadenzaGiorni} giorni` },
	{ valore: 'compleanno', etichetta: 'Compie gli anni', priorita: 10, regola: finestraCompleanno },
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
/** Tutti i codici che la palestra può spegnere. */
export const CODICI_SEGNALE = Object.keys(PER_SEGNALE);

// D-4: da togliere. Le linee del Da fare di prima: le legge ancora Dashboard.jsx, finché le sue
// tessere non diventano una per avviso (shared/daFare.js). Il server non le usa più. Restano solo
// i segnali che ci sono ancora.
export const LINEE = [
	{ valore: 'rinnovi', etichetta: 'Rinnovi', segnali: ['in_scadenza', 'scaduto'] },
	{ valore: 'frequenza', etichetta: 'Chi non viene', segnali: ['assente', 'in_calo'] },
	{ valore: 'documenti', etichetta: 'Documenti', segnali: ['documento_scaduto', 'documento_in_scadenza'] },
	{ valore: 'compleanni', etichetta: 'Compleanni', segnali: ['compleanno'] },
	{ valore: 'bancone', etichetta: 'Al bancone', segnali: ['bentornato', 'traguardo'], soloImpostazioni: true },
];

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

	// Da quando, all'indietro, le iscrizioni si susseguono senza buchi più lunghi di `recuperabileGiorni`.
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

const bisestile = (anno) => (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0;

/** Il giorno del compleanno in un anno: per chi è nato il 29 febbraio, il 28 negli anni normali. */
export function compleannoNel(nascita, anno) {
	const md = giorno(nascita)?.slice(5);
	if (!md) return null;
	return `${anno}-${md === '02-29' && !bisestile(anno) ? '02-28' : md}`;
}

/**
 * Il compleanno vicino a oggi, se cade nella finestra: da `prima` giorni prima a `dopo` giorni
 * dopo (0 e 0: solo il giorno stesso). A cavallo d'anno vale quello giusto: il 2 gennaio, con 3
 * giorni dopo, è ancora il compleanno del 31 dicembre dell'anno prima.
 *
 * @returns {{ data: 'AAAA-MM-GG', anno, giorni } | null} `giorni` quanti ne mancano (negativo: è passato)
 */
export function compleannoVicino(nascita, oggi, prima = SOGLIE.compleannoPrimaGiorni, dopo = SOGLIE.compleannoDopoGiorni) {
	const anno = Number(String(oggi).slice(0, 4));
	for (const a of [anno - 1, anno, anno + 1]) {
		const data = compleannoNel(nascita, a);
		if (!data) return null;
		const giorni = giorniFra(oggi, data);
		if (giorni !== null && giorni >= -dopo && giorni <= prima) return { data, anno: a, giorni };
	}
	return null;
}

/** Vera se oggi è il compleanno di chi è nato in quel giorno (il 29 febbraio, il 28 negli anni normali). */
export const eCompleanno = (nascita, oggi) => compleannoVicino(nascita, oggi, 0, 0) !== null;

const descriviCompleanno = (giorni) => (giorni === 0 ? 'oggi compie gli anni'
	: giorni > 0 ? `compie gli anni ${fra(giorni)}`
		: `ha compiuto gli anni ${giorni === -1 ? 'ieri' : `${-giorni} giorni fa`}`);

/**
 * Lo stato e i segnali di una persona, oggi.
 *
 * @param p.socio        { created_date, archiviato_il, date_of_birth } | null (non è socio: è un
 *                       contatto, che si segue nella sezione Lead)
 * @param p.iscrizioni   [{ id?, plan_name?, start_date, end_date }], passate da `conSospensioni`
 *                       (shared/abbonamenti.js), con `created_date`
 * @param p.documenti    [{ id?, file_name?, document_type, created_date, expiry_date }]
 * @param p.ingressi     { ultimo: 'AAAA-MM-GG'|null, quattro, dodici, totale, prima?, oggi? } — ingressi
 *                       nelle ultime 4 e 12 settimane e in tutto; `prima` l'ultimo giorno di ingresso
 *                       prima di oggi, `oggi` quanti oggi (per i segnali del bancone di chi è già
 *                       entrato dal tornello). null se la palestra non li registra (senza
 *                       ingressi, tutti sembrerebbero assenti)
 * @param p.contatti     { perSegnale: { [codice]: 'AAAA-MM-GG' } }, dal diario: l'ultimo contatto
 *                       per ogni segnale. Conta solo al bancone (nascondi)
 * @param p.soglie       quelle della palestra (soglieDi), con `segnaliSpenti`
 * @returns {{ fase, segnali: [{ codice, titolo, priorita, motivo, azioni, pubblico, nascostoFino, dati }], copertura }}
 *   `fase`: lo stato (FASI). `pubblico`: 'staff' (Da fare), 'socio' (il portale), 'bancone' (chi
 *   entra adesso). `nascostoFino`: il segnale c'è ma non va riproposto prima di quel giorno.
 */
export function segnaliPersona({
	socio = null, iscrizioni = [], documenti = [], ingressi = null, contatti = {}, oggi = oggiIso(), soglie: tutte = SOGLIE,
}) {
	// Chi non è socio è un contatto: il suo lavoro sta nella sezione Lead (shared/lead.js).
	if (!socio) return { fase: 'lead', segnali: [], copertura: null };

	const soglie = { ...SOGLIE.segnali, ...(tutte.segnali ?? {}) };
	const spenti = new Set(tutte.segnaliSpenti ?? []);
	const segnali = [];
	// Un segnale spento dalla palestra non si calcola: non compare da nessuna parte. Lo stato
	// invece sì: "In calo" resta vero anche se nessuno lo segue.
	const aggiungi = (codice, motivo, extra = {}) => {
		if (spenti.has(codice)) return;
		segnali.push({
			codice, titolo: etichettaSegnale(codice), priorita: PER_SEGNALE[codice]?.priorita ?? 0, motivo,
			azioni: ['chiama', 'whatsapp', 'email', 'fatto'], pubblico: 'staff', nascostoFino: null, dati: null, ...extra,
		});
	};

	const copertura = coperturaAbbonamento(iscrizioni, oggi, soglie);
	const inizio = copertura.inizio ?? giorno(socio.created_date) ?? oggi;
	const giorniSocio = giorniFra(inizio, oggi) ?? 0;
	const piano = copertura.riferimento?.plan_name;
	const datiAbbonamento = (giorni, fine) => ({ iscrizione_id: copertura.riferimento?.id ?? null, abbonamento: piano ?? null, giorni, fine });
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
		const media = (Number(ingressi.dodici) || 0) / 3;
		const quattro = Number(ingressi.quattro) || 0;
		// Quello che l'avviso della frequenza mostra: la media e gli ingressi delle ultime 4 settimane.
		const misura = { giorni: giorniSenza, quattro, media: Math.round(media * 10) / 10 };
		if (giorniSenza >= soglie.assenzaGiorni) {
			assente = true;
			aggiungi('assente', ingressi.ultimo ? `non entra da ${giorniSenza} giorni` : `mai entrato in ${giorniSenza} giorni`, { dati: misura });
		}
		// Dopo una ripresa le 4 e le 12 settimane contengono la sospensione: il confronto non dice niente.
		const ripresoDaPoco = copertura.ripresa && giorniFra(copertura.ripresa, oggi) < GIORNI_STORIA_PER_IL_CALO;
		if (!assente && !ripresoDaPoco && giorniSocio >= GIORNI_STORIA_PER_IL_CALO && media >= soglie.mediaMinimaCalo && quattro < (media * soglie.caloPercentuale) / 100) {
			inCalo = true;
			aggiungi('in_calo', `${plurale(quattro, 'ingresso', 'ingressi')} in 4 settimane contro ${Math.round(media)} di media`, { dati: misura });
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

	// Lo scaduto si segue per `scadutoGiorni` dalla fine: poi il suo avviso si chiude da solo.
	if (!archiviato && !copertura.sospensione && senzaAbbonamento && giorniScaduto !== null && giorniScaduto <= (tutte.scadutoGiorni ?? SOGLIE.scadutoGiorni)) {
		aggiungi('scaduto', `scaduto da ${plurale(giorniScaduto, 'giorno', 'giorni')}${piano ? ` (${piano})` : ''}`, { dati: datiAbbonamento(-giorniScaduto, copertura.ultimaFine) });
	}
	if (inScadenza) {
		aggiungi('in_scadenza', `scade ${fra(giorniAllaFine)}`, { dati: datiAbbonamento(giorniAllaFine, copertura.fine) });
		aggiungi('in_scadenza', `Scade ${fra(giorniAllaFine)}: proponi il rinnovo`, { pubblico: 'bancone', azioni: ['proposta_rinnovo'] });
	}

	if (frequenta) {
		// I documenti obbligatori scaduti o in scadenza: la stessa regola del portale e degli
		// ingressi (documentiDaSistemare). Un segnale per genere, con tutti i documenti dentro: Da
		// fare ne fa un avviso per documento (shared/daFare.js). Il documento che manca lo dicono
		// la sua sezione della scheda e il portale, non Da fare.
		const fuori = documentiDaSistemare({ socio, documenti, oggi, giorniInScadenza: tutte.documentoInScadenzaGiorni });
		const descrivi = {
			scaduto: (d) => `${d.nome.toLowerCase()} scaduto${d.scadenza ? ` il ${dataIt(d.scadenza)}` : ''}`,
			in_scadenza: (d) => `${d.nome.toLowerCase()} scade ${fra(d.giorni)}`,
		};
		for (const stato of ['scaduto', 'in_scadenza']) {
			const questi = fuori.filter((d) => d.stato === stato);
			if (questi.length) aggiungi(`documento_${stato}`, questi.map(descrivi[stato]).join(', '), { dati: { documenti: questi } });
		}

		// Per lo staff, da qualche giorno prima a qualche giorno dopo; al bancone, il giorno stesso.
		const vicino = compleannoVicino(socio.date_of_birth, oggi,
			tutte.compleannoPrimaGiorni ?? SOGLIE.compleannoPrimaGiorni, tutte.compleannoDopoGiorni ?? SOGLIE.compleannoDopoGiorni);
		if (vicino) aggiungi('compleanno', descriviCompleanno(vicino.giorni), { dati: vicino });
		if (eCompleanno(socio.date_of_birth, oggi)) {
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

	return { fase: laFase, segnali: nascondi(segnali, contatti, oggi, soglie), copertura };
}

/**
 * Quando un segnale del bancone torna da fare: un saluto basta per oggi, il rinnovo proposto non
 * si ripropone per `contattoNascondeGiorni`. Per lo staff non si nasconde niente: gli avvisi di Da
 * fare si chiudono a mano o da soli (shared/daFare.js).
 */
function nascondi(segnali, { perSegnale = {} } = {}, oggi, soglie) {
	return segnali.map((s) => {
		const il = s.pubblico === 'bancone' && perSegnale?.[s.codice] ? giorno(perSegnale[s.codice]) : null;
		const fino = il ? spostaGiorni(il, s.codice === 'in_scadenza' ? soglie.contattoNascondeGiorni : 1) : null;
		return { ...s, nascostoFino: fino && fino > oggi ? fino : null };
	});
}

/** I segnali da fare adesso per un pubblico, dal più prezioso. */
export function daFare(segnali = [], pubblico = 'staff') {
	return segnali.filter((s) => s.pubblico === pubblico && !s.nascostoFino).sort((a, b) => b.priorita - a.priorita);
}

/** Il perché, in una riga: "3 ingressi in 4 settimane contro 9 di media · scade tra 9 giorni". */
export function perche(segnali = []) {
	return segnali.map((s) => s.motivo).filter(Boolean).join(' · ');
}
