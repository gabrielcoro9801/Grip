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
  // Le regole di Da fare (shared/daFare.js): quando un avviso compare, si chiude da solo o torna.
  scadutoGiorni: 60, // l'avviso di un abbonamento scaduto si chiude da solo tanti giorni dopo la fine
  frequenzaRiapriGiorni: 30, // dopo "Contattato" o "Nascondi avviso", la frequenza torna dopo tanto, se è ancora in calo
  compleannoPrimaGiorni: 3, // l'avviso del compleanno compare tanti giorni prima (0 = il giorno stesso)
  compleannoDopoGiorni: 3, // …e si chiude da solo tanti giorni dopo (0 = il giorno stesso)
  // Il motore dei segnali (shared/segnali.js): le fasi di un socio e quando va cercato.
  segnali: Object.freeze({
    nuovoGiorni: 30, // iscritto da poco: "nuovo"
    assenzaGiorni: 14, // senza ingressi da tanto: "assente" (era GIORNI_RISCHIO_ABBANDONO)
    caloPercentuale: 50, // ingressi delle ultime 4 settimane sotto questa parte della media: "in calo"
    recuperabileGiorni: 60, // un buco fra due abbonamenti più corto di così non fa tornare "nuovo"
    contattoNascondeGiorni: 7, // al bancone, dopo un rinnovo proposto, per tanto non si ripropone
    mediaMinimaCalo: 4, // sotto questa media (ingressi in 4 settimane) un calo non dice niente
    ogniTraguardo: 50, // ogni quanti ingressi si festeggia al bancone
    archiviazioneGiorni: 180, // senza abbonamento da tanto: il giro lo archivia (0 = mai)
  }),
});

// Le soglie che possono valere zero: "mai" per l'archiviazione, "il giorno stesso" per i compleanni.
const ZERO_AMMESSO = new Set(["archiviazioneGiorni", "compleannoPrimaGiorni", "compleannoDopoGiorni"]);
export const sogliaValida = (v, chiave) => Number.isInteger(v) && (v > 0 || (v === 0 && ZERO_AMMESSO.has(chiave))) && v <= 3650;

function fondi(predefinite, scelte) {
  return Object.fromEntries(Object.entries(predefinite).map(([chiave, valore]) => [
    chiave,
    typeof valore === "object"
      ? fondi(valore, scelte?.[chiave])
      : sogliaValida(scelte?.[chiave], chiave) ? scelte[chiave] : valore,
  ]));
}

/**
 * Le soglie di una palestra: le sue dove sono valide, le predefinite per tutto il resto. Porta
 * con sé anche i segnali che la palestra ha spento (`impostazioni.segnali_spenti`): il motore
 * non li calcola affatto. Qui non si controlla che i codici esistano (shared/segnali.js importa
 * questo file, non il contrario): un codice sconosciuto non spegne niente.
 */
export function soglieDi(impostazioni) {
  const spenti = impostazioni?.segnali_spenti;
  return {
    ...fondi(SOGLIE, impostazioni?.soglie),
    segnaliSpenti: Array.isArray(spenti) ? spenti.filter((c) => typeof c === "string") : [],
  };
}
