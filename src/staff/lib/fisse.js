// Le prenotazioni fisse viste dalla finestra: il periodo in una riga, le lezioni che restano, «per
// N lezioni» che diventa una data, e fin dove si può arrivare. Niente React e niente rete; le
// regole vere le applica il server (server/src/lib/prenotazioniFisse.js), qui si dicono prima.
//
// Import relativi con l'estensione: così il file si carica con `node --test` (fisse.test.js).
import { dataIt } from "../../core/domain/sale.js";
import { lezioneFinita } from "../../core/domain/giorni.js";

// Lo stesso tetto del server (MASSIMO_LEZIONI_FISSA): due anni di una sessione settimanale.
export const MASSIMO_LEZIONI_FISSA = 104;

/**
 * Il periodo di una fissa in una riga. Una fissa nata dal portale non ha fine (`al` vuoto): lo
 * staff la crea sempre con una data, il portale ancora no, e la riga lo dice.
 */
export function periodoFissa(fissa) {
  const dal = `dal ${dataIt(fissa.dal)}`;
  return fissa.al ? `${dal} al ${dataIt(fissa.al)}` : `${dal}, senza data di fine (dal portale)`;
}

/** Le lezioni ancora da tenere, in ordine, dal giorno `dal`: attive e non finite. */
export function lezioniDaTenere(lezioni, dal, adesso = new Date()) {
  return lezioni
    .filter((l) => l.status === "active" && l.date >= dal && !lezioneFinita(l, adesso))
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
}

/** «Per N lezioni» come data: quella dell'N-esima lezione da tenere, o null se non ce ne sono abbastanza. */
export function fineDaNumero(daTenere, numero) {
  const n = Number(numero);
  if (!Number.isInteger(n) || n < 1) return null;
  return daTenere[n - 1]?.date ?? null;
}

/**
 * Fin dove può arrivare la fissa: il primo fra l'ultima lezione della sessione e la fine
 * dell'abbonamento del socio (`fineCopertura`, dopo le sospensioni). `fineAbbonamento`
 * undefined vuol dire «non si sa» (le iscrizioni non si sono potute leggere): allora il limite è
 * solo la sessione, e l'abbonamento lo controlla il server.
 *
 * @returns {{ al: string|null, perche: 'sessione'|'abbonamento'|'senza_abbonamento'|null }}
 */
export function limiteFissa({ ultimaLezione, fineAbbonamento }) {
  if (fineAbbonamento === null) return { al: null, perche: "senza_abbonamento" };
  if (!ultimaLezione) return { al: null, perche: null };
  if (fineAbbonamento && fineAbbonamento < ultimaLezione) return { al: fineAbbonamento, perche: "abbonamento" };
  return { al: ultimaLezione, perche: "sessione" };
}

/** Il limite in una frase, per sotto il campo: «Al massimo fino al 20/12/2026, quando finisce la sessione». */
export function descriviLimite({ al, perche }) {
  if (perche === "senza_abbonamento") return "Quel giorno il socio non ha un abbonamento valido.";
  if (!al) return "";
  return perche === "abbonamento"
    ? `Al massimo fino al ${dataIt(al)}, quando finisce l'abbonamento del socio.`
    : `Al massimo fino al ${dataIt(al)}, l'ultima lezione della sessione.`;
}

/**
 * Il periodo scritto nel modulo, controllato come lo controllerà il server: { al } oppure
 * { errore }. `al` è la fine come data, anche quando la si è scritta come numero di lezioni.
 *
 * @param modulo  { dal, fine: 'data' | 'numero', al, numero }
 * @param daTenere le lezioni ancora da tenere da `dal` (`lezioniDaTenere`)
 * @param limite  `limiteFissa`
 */
export function controllaPeriodo(modulo, daTenere, limite, oggi) {
  if (!modulo.dal) return { errore: "Indica da quando." };
  if (modulo.dal < oggi) return { errore: "Una prenotazione fissa comincia oggi o più avanti." };
  let al = modulo.al;
  if (modulo.fine === "numero") {
    const n = Number(modulo.numero);
    if (!Number.isInteger(n) || n < 1 || n > MASSIMO_LEZIONI_FISSA) {
      return { errore: `Il numero di lezioni va da 1 a ${MASSIMO_LEZIONI_FISSA}.` };
    }
    al = fineDaNumero(daTenere, n);
    if (!al) {
      return { errore: `Dal ${dataIt(modulo.dal)} la sessione ha ${daTenere.length} ${daTenere.length === 1 ? "lezione" : "lezioni"}, non ${n}.` };
    }
  }
  if (!al) return { errore: "Indica fino a quando." };
  if (al < modulo.dal) return { errore: "La fine viene prima dell'inizio." };
  if (limite.perche === "senza_abbonamento") return { errore: descriviLimite(limite) };
  if (limite.al && al > limite.al) {
    return { errore: limite.perche === "abbonamento"
      ? `L'abbonamento del socio finisce il ${dataIt(limite.al)}: la fissa non può andare oltre.`
      : `La sessione finisce il ${dataIt(limite.al)}: la fissa non può andare oltre.` };
  }
  return { al, lezioni: daTenere.filter((l) => l.date <= al).length };
}
