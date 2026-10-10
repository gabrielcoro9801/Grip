// Le soglie, in giorni, con cui GRIP decide che cosa c'è da fare: quando un contatto va
// sollecitato, quando un abbonamento o un documento è "in scadenza".
//
// Erano sparse, una per modulo, e nessuna palestra poteva cambiarle. Qui ci sono i valori
// predefiniti; quelli scelti dalla palestra stanno in `organizations.impostazioni.soglie` e li
// fonde `soglieDi`. Un valore della palestra che non è un numero di giorni sensato si ignora:
// una soglia sbagliata in configurazione non deve svuotare né riempire le liste di lavoro.

export const SOGLIE = Object.freeze({
  lead: Object.freeze({
    sollecitoGiorni: 3, // in attesa da tanto: "Da ricontattare"
    ultimoTentativoGiorni: 10, // in attesa da tanto: "Ultimo tentativo"
    tentativiMassimi: 3, // tentativi di fila senza risposta prima di arrendersi
    nonRaggiungibileGiorni: 14, // …e da quanto dev'essere l'ultimo, per chiuderlo da solo
    fermaGiorni: 7, // una conversazione senza novità da tanto: "Conversazioni ferme"
    recuperoGiorni: 90, // un "non interessato" da tanto: si può riprovare
  }),
  // Da quanti giorni prima della fine un abbonamento è "in scadenza": la segreteria deve avere
  // il tempo di proporre il rinnovo.
  abbonamentoInScadenzaGiorni: 14,
  // Da quanti giorni prima della scadenza un documento è "in scadenza".
  documentoInScadenzaGiorni: 30,
  // Il motore dei segnali (shared/segnali.js): le fasi di un socio e quando va cercato.
  segnali: Object.freeze({
    nuovoGiorni: 30, // iscritto da poco: "nuovo"
    ambientamentoGiorni: 90, // fino a qui "ambientamento", la finestra in cui se ne perdono di più
    assenzaGiorni: 14, // senza ingressi da tanto: "assente" (era GIORNI_RISCHIO_ABBANDONO)
    caloPercentuale: 50, // ingressi delle ultime 4 settimane sotto questa parte della media: "in calo"
    recuperabileGiorni: 60, // scaduto da non più di tanto: si può ancora recuperare
    contattoNascondeGiorni: 7, // dopo un contatto, per tanto il segnale non si ripropone
  }),
});

const giorniValidi = (v) => Number.isInteger(v) && v > 0 && v <= 3650;

function fondi(predefinite, scelte) {
  return Object.fromEntries(Object.entries(predefinite).map(([chiave, valore]) => [
    chiave,
    typeof valore === "object"
      ? fondi(valore, scelte?.[chiave])
      : giorniValidi(scelte?.[chiave]) ? scelte[chiave] : valore,
  ]));
}

/** Le soglie di una palestra: le sue dove sono valide, le predefinite per tutto il resto. */
export function soglieDi(impostazioni) {
  return fondi(SOGLIE, impostazioni?.soglie);
}
