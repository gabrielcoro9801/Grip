// Che cosa c'è da sistemare per un socio, adesso: l'abbonamento.
//
// Una regola sola per due posti: il controllo degli ingressi (semaforo verde, giallo, rosso) e le
// Notifiche del portale. Se ne avessero una ciascuno, prima o poi il socio leggerebbe "tutto in
// regola" sul telefono mentre all'ingresso lo fermano. (I documenti sono usciti
// dall'applicazione a novembre 2026: docs/piani/portale.md.)
//
// Gli avvisi non si salvano: si calcolano dalle date ogni volta, e spariscono da soli quando
// il socio rinnova. Un avviso salvato resterebbe vero anche dopo.
import { oggiIso, giorniFra, spostaGiorni } from './giorni.js';
import { abbonamentoCopre, sospensioneIl, GIORNI_ABBONAMENTO_IN_SCADENZA } from './abbonamenti.js';

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${g}/${m}/${a}`; };
const fra = (giorni) => (giorni === 0 ? 'oggi' : giorni === 1 ? 'domani' : `fra ${giorni} giorni`);

/**
 * Gli avvisi di un socio a oggi, dal più grave.
 *
 * Gravità: `rosso` vuol dire che non dovrebbe entrare (abbonamento non valido oggi, socio
 * archiviato); `giallo` che entra ma qualcosa va sistemato (abbonamento in scadenza senza
 * rinnovo).
 *
 * @param socio      { date_of_birth, archiviato_il }
 * @param iscrizioni [{ start_date, end_date }], passate da `conSospensioni` se il socio ne ha
 * @param soglie     quelle della palestra (shared/soglie.js); senza, le predefinite
 * @returns [{ codice, gravita, titolo, testo, azione: 'abbonamento' | null }]
 */
export function avvisiSocio({ socio, iscrizioni = [], oggi = oggiIso(), soglie = null }) {
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


  return avvisi.sort((a, b) => (a.gravita === b.gravita ? 0 : a.gravita === 'rosso' ? -1 : 1));
}

/** Il semaforo di una lista di avvisi: rosso se ce n'è uno rosso, giallo se ce n'è uno, altrimenti verde. */
export function semaforo(avvisi = []) {
  if (avvisi.some((a) => a.gravita === 'rosso')) return 'rosso';
  return avvisi.length ? 'giallo' : 'verde';
}
