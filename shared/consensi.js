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

/** Da dove arriva un consenso: dal portale (il socio), dalla reception (modulo firmato), da un form pubblico. */
export const FONTI_CONSENSO = ["portale", "reception", "form"];

/**
 * Il valore attuale di ogni consenso, dalle righe del registro: l'ultima per tipo. Senza righe
 * il consenso non c'è.
 * @param righe [{ tipo, valore, fonte, created_date }]
 * @returns { [tipo]: { valore, fonte, il } }
 */
export function consensiAttuali(righe = []) {
  const ultime = {};
  for (const r of righe) {
    const prima = ultime[r.tipo];
    if (!prima || String(r.created_date) >= String(prima.il)) {
      ultime[r.tipo] = { valore: Boolean(r.valore), fonte: r.fonte, il: r.created_date };
    }
  }
  return Object.fromEntries(TIPI_CONSENSO.map((t) => [t.valore, ultime[t.valore] ?? { valore: false, fonte: null, il: null }]));
}
