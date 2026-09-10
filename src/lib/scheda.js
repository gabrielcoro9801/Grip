// La forma di una scheda di allenamento, e le poche operazioni che ci si fanno sopra.
//
// Il contenuto di una scheda è un array JSON, quindi non c'è uno schema che lo difenda:
// se ogni schermata se lo costruisse a modo suo, basterebbe un campo dimenticato
// nell'editor per salvare righe che il portale soci non sa più leggere. Le righe nascono
// tutte da qui.
//
// Struttura:
//   scheda    = { …, routines: [] }
//   routine   = { nome, note, esercizi: [] }      ← una giornata: "Giorno 1 — Spinta"
//   esercizio = { exercise_id, exercise_name, muscle_group, recupero_secondi, note, serie: [] }
//   serie     = { reps, rpe }
//
// La routine è il livello che il socio avvia: una scheda è il programma di una settimana,
// e non si esegue tutta in una volta.

import { etichettaGruppo } from "@/lib/gruppiMuscolari";

/** Una serie nuova, opzionalmente ricalcata su quella che la precede. */
export function nuovaSerie(precedente) {
  return { reps: precedente?.reps ?? "", rpe: precedente?.rpe ?? null };
}

/** Un esercizio nuovo, preso dal catalogo, con una prima serie già pronta. */
export function nuovoEsercizio(esercizioDelCatalogo) {
  return {
    // L'id lega la riga al catalogo; nome e gruppo sono copiati accanto perché la scheda
    // già consegnata deve restare leggibile anche se l'esercizio viene rinominato o tolto.
    exercise_id: esercizioDelCatalogo.id,
    exercise_name: esercizioDelCatalogo.name,
    muscle_group: esercizioDelCatalogo.muscle_group ?? "altro",
    recupero_secondi: null,
    note: "",
    serie: [nuovaSerie()],
  };
}

/**
 * Copia in profondità gli esercizi di una scheda.
 *
 * Serve in due punti che sbaglierebbero entrambi con una copia superficiale: aprire una
 * scheda in modifica (senza, cambiare una ripetizione modificherebbe l'oggetto già in
 * elenco, e annullare lascerebbe a schermo il valore nuovo) e creare una scheda da un
 * modello (senza, le due resterebbero legate e correggere la scheda di un socio
 * cambierebbe il modello di tutti).
 */
export function clonaEsercizi(esercizi) {
  return (esercizi ?? []).map((es) => ({
    ...es,
    serie: (es.serie ?? []).map((s) => ({ ...s })),
  }));
}

/** Sposta un elemento di un array di una posizione. Fuori dai bordi non fa niente. */
export function sposta(elenco, da, a) {
  if (a < 0 || a >= elenco.length) return elenco;
  const copia = [...elenco];
  const [preso] = copia.splice(da, 1);
  copia.splice(a, 0, preso);
  return copia;
}

/**
 * Il riepilogo di un esercizio: "4×8" quando le serie sono uguali, "8 · 8 · 6 · 6" quando
 * non lo sono.
 *
 * Un PT scrive spesso serie diverse fra loro — le piramidali sono la norma — e
 * comprimerle tutte in "4×8" mostrerebbe un numero che non è scritto da nessuna parte
 * nella scheda.
 */
export function riepilogoSerie(esercizio) {
  const serie = esercizio?.serie ?? [];
  if (serie.length === 0) return "Nessuna serie";

  const ripetizioni = serie.map((s) => String(s.reps ?? "").trim() || "—");
  const tutteUguali = ripetizioni.every((r) => r === ripetizioni[0]);
  return tutteUguali ? `${serie.length}×${ripetizioni[0]}` : ripetizioni.join(" · ");
}

/** L'intervallo di RPE presente nell'esercizio, o "" se non ne ha nessuno. */
export function riepilogoRpe(esercizio) {
  const valori = (esercizio?.serie ?? [])
    .map((s) => s.rpe)
    .filter((v) => v !== null && v !== undefined && v !== "");
  if (valori.length === 0) return "";
  const min = Math.min(...valori);
  const max = Math.max(...valori);
  return min === max ? `RPE ${min}` : `RPE ${min}-${max}`;
}

/**
 * Quanto è durato un allenamento: "45s", "12:30", "1:04:20".
 *
 * I secondi restano visibili sotto il minuto perché è quello che si vede subito dopo aver
 * premuto "Avvia": un cronometro fermo su "00:00" per un minuto sembra un cronometro rotto.
 */
export function formatDurata(secondi) {
  const totale = Math.max(0, Math.floor(secondi || 0));
  if (totale < 60) return `${totale}s`;
  const ore = Math.floor(totale / 3600);
  const minuti = Math.floor((totale % 3600) / 60);
  const resto = totale % 60;
  const dueCifre = (n) => String(n).padStart(2, "0");
  return ore
    ? `${ore}:${dueCifre(minuti)}:${dueCifre(resto)}`
    : `${minuti}:${dueCifre(resto)}`;
}

/** Il conto alla rovescia del recupero: sempre M:SS, perché è un tempo che si legge di sfuggita. */
export function formatConteggio(secondi) {
  const totale = Math.max(0, Math.ceil(secondi || 0));
  return `${Math.floor(totale / 60)}:${String(totale % 60).padStart(2, "0")}`;
}

/** Il recupero in forma leggibile: 90 → "1' 30\"", 60 → "1'", 45 → "45\"". */
export function formatRecupero(secondi) {
  if (secondi === null || secondi === undefined || secondi === "") return "";
  const totale = Number(secondi);
  if (!Number.isFinite(totale) || totale <= 0) return "";
  const minuti = Math.floor(totale / 60);
  const resto = totale % 60;
  if (!minuti) return `${resto}"`;
  return resto ? `${minuti}' ${resto}"` : `${minuti}'`;
}

/** Quante serie ha in tutto un elenco di esercizi: è la misura del suo volume. */
export function totaleSerie(esercizi) {
  return (esercizi ?? []).reduce((somma, es) => somma + (es.serie?.length ?? 0), 0);
}

/** Le stesse serie, contate su tutte le routine di una scheda. */
export function totaleSerieScheda(routines) {
  return (routines ?? []).reduce((somma, r) => somma + totaleSerie(r.esercizi), 0);
}

/** Quanti esercizi ha in tutto una scheda, sommando le sue routine. */
export function totaleEsercizi(routines) {
  return (routines ?? []).reduce((somma, r) => somma + (r.esercizi?.length ?? 0), 0);
}

/** I gruppi muscolari toccati da un elenco di esercizi, senza ripetizioni. */
export function gruppiDellaScheda(esercizi) {
  const visti = [];
  for (const es of esercizi ?? []) {
    if (es.muscle_group && !visti.includes(es.muscle_group)) visti.push(es.muscle_group);
  }
  return visti.map((codice) => ({ codice, etichetta: etichettaGruppo(codice) }));
}

/** Gli stessi gruppi, su tutte le routine di una scheda. */
export function gruppiDelleRoutine(routines) {
  return gruppiDellaScheda((routines ?? []).flatMap((r) => r.esercizi ?? []));
}

// ---------------------------------------------------------------------------------------
// Le routine
// ---------------------------------------------------------------------------------------

/** Una routine nuova. Il nome predefinito è la giornata, che è come le si chiama. */
export function nuovaRoutine(quanteGiaCeNeSono = 0) {
  return { nome: `Giorno ${quanteGiaCeNeSono + 1}`, note: "", esercizi: [] };
}

/** Copia in profondità le routine di una scheda. Vale quanto detto per clonaEsercizi. */
export function clonaRoutines(routines) {
  return (routines ?? []).map((r) => ({ ...r, esercizi: clonaEsercizi(r.esercizi) }));
}

/**
 * Cosa impedisce di salvare una scheda, se qualcosa lo impedisce.
 *
 * Restituisce il motivo da mostrare, o null se è a posto. Un solo punto di verità: la
 * stessa funzione disabilita il pulsante e spiega perché è disabilitato, così non può
 * succedere che il pulsante sia spento senza che nessuno dica il motivo.
 */
export function motivoNonSalvabile({ name, isTemplate, memberId, routines }) {
  if (!name?.trim()) return "Manca il nome della scheda.";
  if (!isTemplate && !memberId) return "Scegli il socio a cui assegnare la scheda.";
  if (!routines?.length) return "La scheda non ha ancora nessuna routine.";

  const senzaNome = routines.find((r) => !r.nome?.trim());
  if (senzaNome) return "Una routine è senza nome: è quello che il socio sceglie per avviarla.";

  const vuota = routines.find((r) => !r.esercizi?.length);
  if (vuota) return `La routine «${vuota.nome}» non ha nessun esercizio.`;

  for (const routine of routines) {
    const senzaSerie = routine.esercizi.find((es) => !es.serie?.length);
    if (senzaSerie) return `«${senzaSerie.exercise_name}» in «${routine.nome}» non ha nessuna serie.`;
  }
  return null;
}
