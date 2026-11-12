// Gli avvisi di Da fare: i segnali per lo staff (shared/segnali.js) diventati occorrenze precise,
// ognuna con la sua chiave — un abbonamento, un documento, un compleanno di un anno.
//
// Un avviso ha una sola vita: si apre quando il motore lo vede, si chiude a mano o da solo, e
// finisce in Archivio. Qui ci sono solo funzioni pure: quali avvisi ha una persona oggi
// (`avvisiDi`), con che esito si chiude uno che non è più vero (`esitoChiusura`), e in che ordine
// si mostrano (`ordina`). La tabella `avvisi` e l'allineamento stanno nel server.
import { oggiIso, giorniFra } from './giorni.js';
import { segnaliPersona, daFare, compleannoNel } from './segnali.js';
import { SOGLIE } from './soglie.js';

/**
 * I cinque avvisi, nell'ordine della barra. `segnali`: i segnali del motore che li aprono.
 * `chiusure`: gli esiti a mano che valgono per quel tipo.
 */
export const TIPI_AVVISO = [
	{ valore: 'in_scadenza', etichetta: 'In scadenza', titolo: 'Abbonamenti in scadenza', segnali: ['in_scadenza'], chiusure: ['nascosto'] },
	{ valore: 'scaduto', etichetta: 'Scaduti', titolo: 'Abbonamenti scaduti', segnali: ['scaduto'], chiusure: ['nascosto'] },
	{ valore: 'frequenza', etichetta: 'Frequenza', titolo: 'Frequenza in calo', segnali: ['assente', 'in_calo'], chiusure: ['contattato', 'nascosto'] },
	{ valore: 'documento', etichetta: 'Documenti', titolo: 'Documenti in scadenza', segnali: ['documento_scaduto', 'documento_in_scadenza'], chiusure: ['nascosto'] },
	{ valore: 'compleanno', etichetta: 'Compleanni', titolo: 'Compleanni', segnali: ['compleanno'], chiusure: ['auguri_fatti', 'nascosto'] },
];
const PER_TIPO = Object.fromEntries(TIPI_AVVISO.map((t) => [t.valore, t]));
export const tipoAvviso = (v) => PER_TIPO[v] ?? null;

/**
 * Come si chiude un avviso. `aMano`: lo sceglie chi lavora la lista; gli altri li scrive GRIP.
 * Un «Nascosto» si può ripristinare; le altre chiusure a mano no. Quelle automatiche si riaprono
 * da sole se l'avviso torna vero.
 */
export const ESITI = [
	{ valore: 'nascosto', etichetta: 'Nascosto', aMano: true },
	{ valore: 'contattato', etichetta: 'Contattato', aMano: true },
	{ valore: 'auguri_fatti', etichetta: 'Auguri fatti', aMano: true },
	{ valore: 'rinnovato', etichetta: 'Rinnovato', aMano: false },
	{ valore: 'passato_in_scaduti', etichetta: 'Passato in Scaduti', aMano: false },
	{ valore: 'documento_caricato', etichetta: 'Documento caricato', aMano: false },
	{ valore: 'socio_archiviato', etichetta: 'Socio archiviato', aMano: false },
	{ valore: 'chiuso_dopo_giorni', etichetta: 'Chiuso dopo N giorni', aMano: false },
	{ valore: 'non_piu_da_fare', etichetta: 'Non più da fare', aMano: false },
];
const PER_ESITO = Object.fromEntries(ESITI.map((e) => [e.valore, e]));

/** Vera se chi lavora la lista può chiudere a mano un avviso di quel tipo con quell'esito. */
export const esitoAManoValido = (esito, tipo) => Boolean(PER_TIPO[tipo]?.chiusure.includes(esito));

/** L'esito in parole, con le soglie della palestra: «Chiuso dopo 60 giorni». */
export function etichettaEsito(esito, tipo, soglie = SOGLIE) {
	if (esito === 'chiuso_dopo_giorni') {
		const n = tipo === 'compleanno' ? (soglie.compleannoDopoGiorni ?? SOGLIE.compleannoDopoGiorni) : (soglie.scadutoGiorni ?? SOGLIE.scadutoGiorni);
		return n === 0 ? 'Chiuso il giorno stesso' : `Chiuso dopo ${n} ${n === 1 ? 'giorno' : 'giorni'}`;
	}
	return PER_ESITO[esito]?.etichetta ?? esito;
}

const giorno = (d) => (d ? String(d).slice(0, 10) : null);
const dataIt = (iso) => { const [a, m, g] = iso.split('-'); return `${g}/${m}/${a}`; };
const numero = (n) => String(n).replace('.', ',');

/** Quando, rispetto a oggi: «oggi», «domani», «tra 4 giorni», «1 giorno fa», «10 giorni fa». */
export function quando(data, oggi = oggiIso()) {
	const n = giorniFra(oggi, data);
	if (n === null) return '';
	if (n === 0) return 'oggi';
	if (n === 1) return 'domani';
	if (n > 1) return `tra ${n} giorni`;
	return `${-n} ${n === -1 ? 'giorno' : 'giorni'} fa`;
}

/** La frase della scheda: «Abbonamento in scadenza il 04/11/2026 · tra 4 giorni». */
export function testoAvviso(avviso, oggi = oggiIso()) {
	const { frase = '', data = null } = avviso.dati ?? {};
	return data && avviso.tipo !== 'frequenza' ? `${frase} · ${quando(data, oggi)}` : frase;
}

/**
 * Gli avvisi aperti di una persona oggi: [{ tipo, chiave, dati }]. `dati` è l'istantanea che
 * resta in Archivio: la data a cui si riferisce, la frase, e quello che serve alle azioni.
 *
 * Chiavi: l'id dell'abbonamento (lo stesso per In scadenza e Scaduto), l'id del documento, l'anno
 * del compleanno. Per la Frequenza è il giorno d'apertura, cioè oggi: il server la riconosce come
 * già aperta dal tipo, non dalla chiave.
 *
 * @param persona { segnali } già calcolati (server/src/lib/segnali.js, situazioni), oppure i dati
 *                da dare a `segnaliPersona` ({ socio, iscrizioni, documenti, ingressi })
 * @param soglie  quelle della palestra (soglieDi), con `segnaliSpenti`: un segnale spento non apre avvisi
 */
export function avvisiDi(persona, oggi = oggiIso(), soglie = SOGLIE) {
	const segnali = persona.segnali ?? segnaliPersona({ ...persona, oggi, soglie }).segnali;
	const avvisi = [];
	for (const s of daFare(segnali, 'staff')) {
		const d = s.dati ?? {};
		if ((s.codice === 'in_scadenza' || s.codice === 'scaduto') && d.iscrizione_id) {
			const scaduto = s.codice === 'scaduto';
			avvisi.push({
				tipo: s.codice, chiave: String(d.iscrizione_id),
				dati: {
					data: d.fine, abbonamento: d.abbonamento, iscrizione_id: d.iscrizione_id,
					frase: `Abbonamento ${scaduto ? 'scaduto' : 'in scadenza'} il ${dataIt(d.fine)}`,
				},
			});
		} else if (s.codice === 'assente' || s.codice === 'in_calo') {
			avvisi.push({
				tipo: 'frequenza', chiave: oggi,
				dati: {
					data: null, segnale: s.codice, quattro: d.quattro, media: d.media, giorni: d.giorni,
					frase: `Frequenza media ogni 4 settimane: ${numero(d.media)} · Entrate nelle ultime 4 settimane: ${d.quattro}`,
				},
			});
		} else if (s.codice === 'documento_scaduto' || s.codice === 'documento_in_scadenza') {
			// Un avviso per documento, non uno per persona.
			for (const doc of d.documenti ?? []) {
				if (!doc.documento_id) continue;
				const scaduto = doc.stato === 'scaduto';
				avvisi.push({
					tipo: 'documento', chiave: String(doc.documento_id),
					dati: {
						data: doc.scadenza, documento: doc.nome, tipo_documento: doc.tipo, stato: doc.stato,
						documento_id: doc.documento_id, file_name: doc.file_name,
						frase: doc.scadenza ? `${doc.nome} ${scaduto ? 'scaduto' : 'in scadenza'} il ${dataIt(doc.scadenza)}` : `${doc.nome} scaduto`,
					},
				});
			}
		} else if (s.codice === 'compleanno' && d.data) {
			avvisi.push({
				tipo: 'compleanno', chiave: String(d.anno),
				dati: { data: d.data, frase: `Compleanno il ${dataIt(d.data).slice(0, 5)}` },
			});
		}
	}
	return avvisi;
}

/**
 * Con che esito si chiude da solo un avviso aperto che il motore non vede più.
 *
 * @param avviso  { tipo, chiave, dati, aperto_il }
 * @param persona { archiviato_il, iscrizioni: [{ id, start_date, end_date }], documenti: [{ id,
 *                document_type, created_date }] } — i dati grezzi, non i segnali: «rinnovato» e
 *                «documento caricato» si vedono solo da lì
 * @param oggi, soglie  per le finestre: lo scaduto dopo `scadutoGiorni`, il compleanno dopo `compleannoDopoGiorni`
 */
export function esitoChiusura(avviso, persona = {}, oggi = oggiIso(), soglie = SOGLIE) {
	if (persona.archiviato_il) return 'socio_archiviato';
	const { tipo, chiave, dati = {} } = avviso;
	const iscrizioni = persona.iscrizioni ?? [];
	const documenti = persona.documenti ?? [];

	if (tipo === 'in_scadenza' || tipo === 'scaduto') {
		const fine = giorno(dati?.data) ?? giorno(iscrizioni.find((i) => String(i.id) === String(chiave))?.end_date);
		// Rinnovato: un altro abbonamento che copre oltre la fine di questo.
		const rinnovato = iscrizioni.some((i) => String(i.id) !== String(chiave) && (!i.end_date || !fine || giorno(i.end_date) > fine));
		if (rinnovato) return 'rinnovato';
		if (tipo === 'in_scadenza') return fine && fine < oggi ? 'passato_in_scaduti' : 'non_piu_da_fare';
		return fine && giorniFra(fine, oggi) > (soglie.scadutoGiorni ?? SOGLIE.scadutoGiorni) ? 'chiuso_dopo_giorni' : 'non_piu_da_fare';
	}
	if (tipo === 'documento') {
		const questo = documenti.find((d) => String(d.id) === String(chiave));
		const tipoDocumento = dati?.tipo_documento ?? questo?.document_type;
		const dal = questo?.created_date ?? avviso.aperto_il;
		const nuovo = documenti.some((d) => String(d.id) !== String(chiave) && d.document_type === tipoDocumento
			&& (!dal || new Date(d.created_date) > new Date(dal)));
		return nuovo ? 'documento_caricato' : 'non_piu_da_fare';
	}
	if (tipo === 'compleanno') {
		const data = giorno(dati?.data) ?? compleannoNel(persona.date_of_birth, Number(chiave));
		return data && giorniFra(data, oggi) > (soglie.compleannoDopoGiorni ?? SOGLIE.compleannoDopoGiorni) ? 'chiuso_dopo_giorni' : 'non_piu_da_fare';
	}
	return 'non_piu_da_fare';
}

// Prima i valori nulli in fondo, poi il nome: a parità, l'ordine non cambia da una volta all'altra.
const confronta = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : a < b ? -1 : 1);
const PER_TIPO_ORDINE = {
	in_scadenza: (a, b) => confronta(a.dati?.data, b.dati?.data), // la fine più vicina in alto
	scaduto: (a, b) => confronta(b.dati?.data, a.dati?.data), // il più recente in alto
	frequenza: (a, b) => confronta(a.dati?.quattro, b.dati?.quattro) || confronta(b.dati?.media, a.dati?.media), // chi entra meno
	documento: (a, b) => confronta(a.dati?.data, b.dati?.data), // per data di scadenza
	compleanno: (a, b) => confronta(a.dati?.data, b.dati?.data), // per data
};

/** Gli avvisi di una scheda nell'ordine dell'urgenza (P1). Non cambia l'elenco che riceve. */
export function ordina(avvisi = [], tipo) {
	return [...avvisi].sort((a, b) => (PER_TIPO_ORDINE[tipo ?? a.tipo]?.(a, b) || 0)
		|| String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'it'));
}
