// La giornata a ore, come in Google Calendar: ogni lezione è un blocco alto quanto dura, e
// quelle che si sovrappongono si dividono la larghezza in colonne.
//
// Pura, senza React: GiornoDialog la disegna, i test la provano.

const minuti = (orario) => {
  const [h, m] = String(orario ?? "").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Dove sta ogni lezione nella giornata.
 *
 * Le lezioni che si toccano, anche a catena (A con B, B con C), formano un gruppo, e tutto il
 * gruppo si divide nello stesso numero di colonne: altrimenti A e B avrebbero larghezze diverse
 * pur stando affiancate. Ogni lezione va nella prima colonna libera. Una lezione che finisce
 * quando un'altra comincia non la tocca: stanno una sotto l'altra, a tutta larghezza.
 *
 * @template {{ start_time: string, end_time: string }} L
 * @param {L[]} lezioni
 * @returns {{ lezione: L, inizio: number, fine: number, colonna: number, colonne: number }[]}
 *   inizio e fine in minuti dalla mezzanotte, nell'ordine di inizio.
 */
export function disponiLezioni(lezioni) {
  const blocchi = (lezioni ?? [])
    .map((lezione) => {
      const inizio = minuti(lezione.start_time);
      // Una lezione senza durata resta visibile: almeno un quarto d'ora.
      const fine = Math.max(minuti(lezione.end_time), inizio + 15);
      return { lezione, inizio, fine, colonna: 0, colonne: 1 };
    })
    .sort((a, b) => a.inizio - b.inizio || b.fine - a.fine);

  let gruppo = [];
  let fineGruppo = -1;
  const chiudiGruppo = () => {
    const colonne = gruppo.reduce((n, b) => Math.max(n, b.colonna + 1), 1);
    for (const b of gruppo) b.colonne = colonne;
    gruppo = [];
  };

  for (const blocco of blocchi) {
    if (gruppo.length && blocco.inizio >= fineGruppo) chiudiGruppo();
    // La prima colonna in cui l'ultima lezione è già finita.
    const fineColonne = [];
    for (const b of gruppo) fineColonne[b.colonna] = Math.max(fineColonne[b.colonna] ?? -1, b.fine);
    let colonna = 0;
    while (fineColonne[colonna] !== undefined && fineColonne[colonna] > blocco.inizio) colonna++;
    blocco.colonna = colonna;
    gruppo.push(blocco);
    fineGruppo = gruppo.length === 1 ? blocco.fine : Math.max(fineGruppo, blocco.fine);
  }
  if (gruppo.length) chiudiGruppo();
  return blocchi;
}

/**
 * Le ore che la colonna mostra: dalle 7, o dall'ora della prima lezione se comincia prima,
 * fino alle 22, o all'ora in cui finisce l'ultima se va oltre.
 * @returns {{ da: number, a: number }} ore intere, `a` esclusa (da 7 a 22 vuol dire 7:00–22:00).
 */
export function intervalloOre(lezioni, { da = 7, a = 22 } = {}) {
  let inizio = da;
  let fine = a;
  for (const l of lezioni ?? []) {
    inizio = Math.min(inizio, Math.floor(minuti(l.start_time) / 60));
    fine = Math.max(fine, Math.ceil(minuti(l.end_time) / 60));
  }
  return { da: inizio, a: Math.min(fine, 24) };
}
