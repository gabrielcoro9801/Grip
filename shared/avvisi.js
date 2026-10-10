// Che cosa c'è da sistemare per un socio, adesso: abbonamento e documenti.
//
// Una regola sola per due posti: il controllo degli ingressi (semaforo verde, giallo, rosso) e la
// sezione "Notifiche e avvisi" del portale. Se ne avessero una ciascuno, prima o poi il socio
// leggerebbe "tutto in regola" sul telefono mentre all'ingresso lo fermano.
//
// Gli avvisi non si salvano: si calcolano dalle date ogni volta, e spariscono da soli quando
// il socio rinnova o porta il documento. Un avviso salvato resterebbe vero anche dopo.
import { oggiIso, giorniFra, spostaGiorni } from './giorni.js';
import { abbonamentoCopre, sospensioneIl, GIORNI_ABBONAMENTO_IN_SCADENZA } from './abbonamenti.js';
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
 * @param iscrizioni [{ start_date, end_date }], passate da `conSospensioni` se il socio ne ha
 * @param documenti  [{ document_type, created_date, expiry_date }]
 * @param soglie     quelle della palestra (shared/soglie.js), per il "documento in scadenza"; senza, le predefinite
 * @returns [{ codice, gravita, titolo, testo, azione: 'abbonamento' | 'documenti' | null }]
 */
export function avvisiSocio({ socio, iscrizioni = [], documenti = [], oggi = oggiIso(), soglie = null }) {
  const avvisi = [];

  if (socio?.archiviato_il) {
    avvisi.push({ codice: 'archiviato', gravita: 'rosso', titolo: 'Socio archiviato', testo: 'Ha lasciato la palestra: per tornare va riattivato dalla reception.', azione: null });
  }

  // L'abbonamento: valido oggi? E se finisce presto, c'è già il rinnovo? Sospeso è un'altra cosa
  // da scaduto: non entra, ma non c'è niente da rinnovare.
  const sospensione = sospensioneIl(iscrizioni, oggi);
  if (sospensione) {
    avvisi.push({
      codice: 'abbonamento_sospeso', gravita: 'rosso', titolo: 'Abbonamento sospeso',
      testo: `È sospeso fino al ${dataIt(sospensione.al)}: riprende il ${dataIt(spostaGiorni(sospensione.al, 1))}, e la scadenza slitta di altrettanto.`,
      azione: 'abbonamento',
    });
  } else if (!abbonamentoCopre(iscrizioni, oggi)) {
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
    if (!rinnovato && giorni !== null && giorni <= (soglie?.abbonamentoInScadenzaGiorni ?? GIORNI_ABBONAMENTO_IN_SCADENZA)) {
      avvisi.push({
        codice: 'abbonamento_in_scadenza', gravita: 'giallo', titolo: 'Abbonamento in scadenza',
        testo: `Scade il ${dataIt(fineCopertura)} (${fra(giorni)}): rinnovalo per non perdere le prenotazioni.`, azione: 'abbonamento',
      });
    }
  }

  for (const d of documentiDaSistemare({ socio, documenti, oggi, giorniInScadenza: soglie?.documentoInScadenzaGiorni })) {
    const codice = `${d.tipo}_${d.stato}`;
    if (d.stato === 'mancante') {
      avvisi.push({ codice, gravita: 'giallo', titolo: `${d.nome} mancante`, testo: `Portalo in reception per essere in regola.`, azione: 'documenti' });
    } else if (d.stato === 'scaduto') {
      avvisi.push({ codice, gravita: 'giallo', titolo: `${d.nome} scaduto`, testo: `${d.scadenza ? `È scaduto il ${dataIt(d.scadenza)}: ` : ''}portane uno nuovo in reception.`, azione: 'documenti' });
    } else {
      avvisi.push({ codice, gravita: 'giallo', titolo: `${d.nome} in scadenza`, testo: `Scade il ${dataIt(d.scadenza)} (${fra(d.giorni)}): portane uno nuovo prima.`, azione: 'documenti' });
    }
  }

  return avvisi.sort((a, b) => (a.gravita === b.gravita ? 0 : a.gravita === 'rosso' ? -1 : 1));
}

/**
 * I documenti obbligatori di un socio che non sono a posto, uno per tipo: mancante, scaduto, o in
 * scadenza senza un sostituto già valido. Obbligatori sono i tipi con `atteso` (TIPI_DOCUMENTO,
 * il consenso dei genitori solo per i minorenni): un tipo reso obbligatorio domani entra da solo.
 * È la regola del portale, del controllo degli ingressi e della linea Documenti di Da fare.
 *
 * @returns [{ tipo, nome, stato: 'mancante'|'scaduto'|'in_scadenza', scadenza, giorni, documento_id, file_name }]
 */
export function documentiDaSistemare({ socio, documenti = [], oggi = oggiIso(), giorniInScadenza }) {
  const conStato = conStatoDocumenti(documenti, (d) => (d ? giorniFra(oggi, String(d).slice(0, 10)) : null), giorniInScadenza)
    .filter((d) => d.stato !== 'archiviato');
  const fuori = [];
  for (const tipo of TIPI_DOCUMENTO) {
    if (!tipoAtteso(tipo, socio, oggi)) continue;
    const suoi = conStato.filter((d) => d.document_type === tipo.valore);
    const voce = (stato, d = null) => ({
      tipo: tipo.valore, nome: tipo.etichetta, stato,
      scadenza: d?.expiry_date ? String(d.expiry_date).slice(0, 10) : null, giorni: d?.giorni_alla_scadenza ?? null,
      documento_id: d?.id ?? null, file_name: d?.file_name ?? null,
    });
    if (suoi.length === 0) fuori.push(voce('mancante'));
    else if (suoi.every((d) => d.stato === 'scaduto')) {
      fuori.push(voce('scaduto', [...suoi].sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date))).pop()));
    } else if (!suoi.some((d) => d.stato === 'valido') && suoi.some((d) => d.stato === 'in_scadenza')) {
      fuori.push(voce('in_scadenza', suoi.find((x) => x.stato === 'in_scadenza')));
    }
  }
  return fuori;
}

/** Il semaforo di una lista di avvisi: rosso se ce n'è uno rosso, giallo se ce n'è uno, altrimenti verde. */
export function semaforo(avvisi = []) {
  if (avvisi.some((a) => a.gravita === 'rosso')) return 'rosso';
  return avvisi.length ? 'giallo' : 'verde';
}
