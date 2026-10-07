// Che cosa c'è da sistemare per un socio, adesso: abbonamento e documenti.
//
// Una regola sola per due posti: il bancone degli ingressi (semaforo verde, giallo, rosso) e la
// sezione "Notifiche e avvisi" del portale. Se ne avessero una ciascuno, prima o poi il socio
// leggerebbe "tutto in regola" sul telefono mentre la reception lo ferma all'ingresso.
//
// Gli avvisi non si salvano: si calcolano dalle date ogni volta, e spariscono da soli quando
// il socio rinnova o porta il documento. Un avviso salvato resterebbe vero anche dopo.
import { oggiIso, giorniFra } from './giorni.js';
import { abbonamentoCopre, GIORNI_ABBONAMENTO_IN_SCADENZA } from './abbonamenti.js';
import { TIPI_DOCUMENTO, tipoAtteso, conStatoDocumenti } from './anagrafica.js';

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${g}/${m}/${a}`; };
const fra = (giorni) => (giorni === 0 ? 'oggi' : giorni === 1 ? 'domani' : `fra ${giorni} giorni`);

/**
 * Gli avvisi di un socio a oggi, dal più grave.
 *
 * Gravità: `rosso` vuol dire che non dovrebbe entrare (abbonamento non valido oggi, socio
 * archiviato); `giallo` che entra ma qualcosa va sistemato (documenti scaduti, mancanti o in
 * scadenza, abbonamento in scadenza senza rinnovo).
 *
 * @param socio      { date_of_birth, archiviato_il }
 * @param iscrizioni [{ start_date, end_date }]
 * @param documenti  [{ document_type, created_date, expiry_date }]
 * @returns [{ codice, gravita, titolo, testo, azione: 'abbonamento' | 'documenti' | null }]
 */
export function avvisiSocio({ socio, iscrizioni = [], documenti = [], oggi = oggiIso() }) {
  const avvisi = [];

  if (socio?.archiviato_il) {
    avvisi.push({ codice: 'archiviato', gravita: 'rosso', titolo: 'Socio archiviato', testo: 'Ha lasciato la palestra: per tornare va riattivato dalla reception.', azione: null });
  }

  // L'abbonamento: valido oggi? E se finisce presto, c'è già il rinnovo?
  if (!abbonamentoCopre(iscrizioni, oggi)) {
    const ultima = iscrizioni.map((i) => i.end_date && String(i.end_date).slice(0, 10)).filter((d) => d && d < oggi).sort().pop();
    avvisi.push({
      codice: 'abbonamento_non_valido', gravita: 'rosso',
      titolo: ultima ? 'Abbonamento scaduto' : 'Nessun abbonamento',
      testo: ultima ? `È scaduto il ${dataIt(ultima)}: rinnovalo in reception per entrare e prenotare.` : 'Non c\'è un abbonamento valido oggi: rivolgiti alla reception.',
      azione: 'abbonamento',
    });
  } else {
    const fineCopertura = iscrizioni
      .filter((i) => abbonamentoCopre([i], oggi))
      .map((i) => (i.end_date ? String(i.end_date).slice(0, 10) : '9999-12-31')).sort().pop();
    const rinnovato = iscrizioni.some((i) => i.start_date && String(i.start_date).slice(0, 10) > oggi);
    const giorni = giorniFra(oggi, fineCopertura);
    if (!rinnovato && giorni !== null && giorni <= GIORNI_ABBONAMENTO_IN_SCADENZA) {
      avvisi.push({
        codice: 'abbonamento_in_scadenza', gravita: 'giallo', titolo: 'Abbonamento in scadenza',
        testo: `Scade il ${dataIt(fineCopertura)} (${fra(giorni)}): rinnovalo per non perdere le prenotazioni.`, azione: 'abbonamento',
      });
    }
  }

  // I documenti attesi per questo socio (il consenso dei genitori solo se è minorenne).
  const conStato = conStatoDocumenti(documenti, (d) => (d ? giorniFra(oggi, String(d).slice(0, 10)) : null))
    .filter((d) => d.stato !== 'archiviato');
  for (const tipo of TIPI_DOCUMENTO) {
    if (!tipoAtteso(tipo, socio, oggi)) continue;
    const suoi = conStato.filter((d) => d.document_type === tipo.valore);
    const nome = tipo.etichetta;
    if (suoi.length === 0) {
      avvisi.push({ codice: `${tipo.valore}_mancante`, gravita: 'giallo', titolo: `${nome} mancante`, testo: `Portalo in reception: serve per allenarti in regola.`, azione: 'documenti' });
    } else if (suoi.every((d) => d.stato === 'scaduto')) {
      const scadenza = suoi.map((d) => d.expiry_date).filter(Boolean).sort().pop();
      avvisi.push({ codice: `${tipo.valore}_scaduto`, gravita: 'giallo', titolo: `${nome} scaduto`, testo: `${scadenza ? `È scaduto il ${dataIt(scadenza)}: ` : ''}portane uno nuovo in reception.`, azione: 'documenti' });
    } else if (!suoi.some((d) => d.stato === 'valido') && suoi.some((d) => d.stato === 'in_scadenza')) {
      const d = suoi.find((x) => x.stato === 'in_scadenza');
      avvisi.push({ codice: `${tipo.valore}_in_scadenza`, gravita: 'giallo', titolo: `${nome} in scadenza`, testo: `Scade il ${dataIt(d.expiry_date)} (${fra(d.giorni_alla_scadenza)}): portane uno nuovo prima.`, azione: 'documenti' });
    }
  }

  return avvisi.sort((a, b) => (a.gravita === b.gravita ? 0 : a.gravita === 'rosso' ? -1 : 1));
}

/** Il semaforo di una lista di avvisi: rosso se ce n'è uno rosso, giallo se ce n'è uno, altrimenti verde. */
export function semaforo(avvisi = []) {
  if (avvisi.some((a) => a.gravita === 'rosso')) return 'rosso';
  return avvisi.length ? 'giallo' : 'verde';
}
