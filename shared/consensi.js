// I consensi alle comunicazioni promozionali, uno per canale.
//
// Sono distinti dal consenso al trattamento dei dati (che si raccoglie all'iscrizione): senza
// questi una palestra non manda una promozione, una riconquista o gli auguri. Le comunicazioni
// di servizio — l'abbonamento che scade, la lezione annullata — non ne hanno bisogno.
//
// Si salvano come registro, una riga per ogni scelta, con chi l'ha registrata e da dove: il
// valore di oggi è l'ultima riga, e lo storico è la prova di quando e come è stato dato.

export const TIPI_CONSENSO = [
  { valore: "marketing_email", etichetta: "Email promozionali" },
  { valore: "marketing_sms", etichetta: "SMS promozionali" },
  { valore: "marketing_push", etichetta: "Notifiche promozionali sull'app" },
];

export const tipoConsensoValido = (v) => TIPI_CONSENSO.some((t) => t.valore === v);

/**
 * Da dove arriva un consenso: dal portale (il socio), dalla reception (modulo firmato), da un form
 * pubblico, o dal link di disiscrizione in fondo a un messaggio (che lo toglie soltanto).
 */
export const FONTI_CONSENSO = ["portale", "reception", "form", "disiscrizione"];

const istante = (d) => (d ? new Date(d).getTime() : 0);

/**
 * Se una riga del registro dà davvero il consenso. Dal portale (o da un form) la prova è la riga
 * stessa: chi, quando, da dove (GDPR art. 7.1 non chiede una forma scritta). Dalla reception la
 * prova è il modulo firmato caricato fra i documenti del socio: finché non c'è, o se viene
 * eliminato, il consenso non vale.
 */
export const consensoProvato = (r) => Boolean(r.valore) && (r.fonte !== "reception" || Boolean(r.documento_presente));

/**
 * Il valore attuale di ogni consenso, dalle righe del registro: l'ultima per tipo (per istante:
 * le date arrivano dal database come Date, e come testo non si confrontano). Senza righe il
 * consenso non c'è.
 * @param righe [{ tipo, valore, fonte, created_date, documento_id?, documento_presente? }]
 * @returns { [tipo]: { valore, fonte, il, senza_prova } } — `senza_prova`: dato in reception, ma
 *   il modulo non c'è (più): vale come non dato.
 */
export function consensiAttuali(righe = []) {
  const ultime = {};
  for (const r of righe) {
    const prima = ultime[r.tipo];
    if (!prima || istante(r.created_date) >= istante(prima.il)) {
      ultime[r.tipo] = {
        valore: consensoProvato(r), fonte: r.fonte, il: r.created_date,
        senza_prova: Boolean(r.valore) && !consensoProvato(r),
      };
    }
  }
  return Object.fromEntries(TIPI_CONSENSO.map((t) => [t.valore, ultime[t.valore] ?? { valore: false, fonte: null, il: null, senza_prova: false }]));
}
