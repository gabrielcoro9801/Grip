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

// Import relativo e non con l'alias "@", come già fa lib/permissions.js: così questo
// modulo si carica anche fuori da Vite, ed è quello che permette di provarne le funzioni
// con `node --test` senza tirarsi dietro un intero framework di test.
import { etichettaGruppo } from "./gruppiMuscolari.js";

/**
 * I tipi di serie.
 *
 * `normale` è il valore assunto quando manca, così le schede scritte prima che i tipi
 * esistessero restano valide senza doverle riscrivere.
 *
 * `volume: false` dice che la serie non entra nel conteggio del carico sollevato: il
 * riscaldamento si fa per scaldarsi, e sommarlo al lavoro vero gonfia il numero con cui si
 * confronta questa settimana con la scorsa.
 */
export const TIPI_SERIE = {
  normale: { etichetta: "Serie di lavoro", sigla: "", volume: true },
  riscaldamento: { etichetta: "Riscaldamento", sigla: "R", volume: false },
  dropset: { etichetta: "Drop set", sigla: "D", volume: true },
  cedimento: { etichetta: "A cedimento", sigla: "C", volume: true },
};

export function tipoSerie(codice) {
  return TIPI_SERIE[codice] ?? TIPI_SERIE.normale;
}

/** Una serie nuova, opzionalmente ricalcata su quella che la precede. */
export function nuovaSerie(precedente) {
  return {
    reps: precedente?.reps ?? "",
    rpe: precedente?.rpe ?? null,
    // Il tipo si eredita: dopo una serie di riscaldamento se ne fa quasi sempre un'altra.
    tipo: precedente?.tipo ?? "normale",
  };
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

// ---------------------------------------------------------------------------------------
// Gli allenamenti svolti
// ---------------------------------------------------------------------------------------

/**
 * Serie e volume di un allenamento, dalle righe registrate.
 *
 * Sta qui e non nella schermata della sessione perché gli stessi due numeri servono anche
 * al personal trainer che rilegge l'allenamento: se li calcolassero in due punti diversi,
 * prima o poi il socio e il suo istruttore vedrebbero due volumi diversi per la stessa
 * seduta, ed è esattamente il tipo di discrepanza che nessuno riesce a spiegare.
 *
 * Accetta sia le righe che arrivano dall'API (`peso_usato`, `reps_fatte`) sia quelle in
 * lavorazione nella sessione (`kg`, `reps`), perché sono la stessa cosa in due momenti.
 */
export function statisticheAllenamento(righe) {
  let serie = 0;
  let volume = 0;
  for (const riga of righe ?? []) {
    // Il riscaldamento non è volume di allenamento: contarlo gonfia il numero con cui si
    // confronta questa settimana con la scorsa, ed è il motivo per cui lo si distingue.
    if (!tipoSerie(riga.tipo_serie ?? riga.tipo).volume) continue;
    serie += 1;
    const peso = Number(riga.peso_usato ?? riga.kg ?? 0);
    const reps = Number(riga.reps_fatte ?? riga.reps ?? 0);
    if (Number.isFinite(peso) && Number.isFinite(reps)) volume += peso * reps;
  }
  return { serie, volume };
}

/** Il lunedì della settimana di una data, a mezzanotte. La settimana comincia di lunedì. */
function lunedi(quando) {
  const giorno = new Date(quando);
  giorno.setHours(0, 0, 0, 0);
  // getDay() dà 0 per domenica: va trattata come ultimo giorno, non come primo.
  const scarto = (giorno.getDay() + 6) % 7;
  giorno.setDate(giorno.getDate() - scarto);
  return giorno.getTime();
}

/**
 * Quante volte ci si è allenati, e da quante settimane non si salta.
 *
 * È la misura che fa tornare le persone: "tre volte questa settimana" dice più di
 * qualsiasi grafico, e la fila di settimane è la cosa che nessuno vuole interrompere.
 *
 * La fila conta le settimane consecutive con almeno una seduta, all'indietro. Si parte
 * dalla settimana in corso solo se ci si è già allenati: altrimenti si guarda quella
 * prima, perché è lunedì mattina e non aver ancora fatto niente non è saltare una
 * settimana — sarebbe una fila che si azzera ogni domenica a mezzanotte.
 */
export function statisticheSettimanali(sessioni, adesso = Date.now()) {
  const concluse = (sessioni ?? []).filter((s) => s.terminata_alle);
  const settimaneConSeduta = new Set(concluse.map((s) => lunedi(s.iniziata_alle)));

  const inizioSettimana = lunedi(adesso);
  const inizioMese = new Date(adesso);
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);

  const questaSettimana = concluse.filter((s) => new Date(s.iniziata_alle).getTime() >= inizioSettimana).length;
  const questoMese = concluse.filter((s) => new Date(s.iniziata_alle).getTime() >= inizioMese.getTime()).length;

  const SETTIMANA = 7 * 86400000;
  let settimaneDiFila = 0;
  let cursore = settimaneConSeduta.has(inizioSettimana) ? inizioSettimana : inizioSettimana - SETTIMANA;
  while (settimaneConSeduta.has(cursore)) {
    settimaneDiFila += 1;
    cursore -= SETTIMANA;
  }

  return { questaSettimana, questoMese, settimaneDiFila };
}

/** Quanto è durata una sessione, in secondi. Se è ancora aperta, quanto sta durando. */
export function durataSessione(sessione, adesso = Date.now()) {
  if (!sessione?.iniziata_alle) return 0;
  const fine = sessione.terminata_alle ? new Date(sessione.terminata_alle).getTime() : adesso;
  return Math.max(0, (fine - new Date(sessione.iniziata_alle).getTime()) / 1000);
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
// Superset e circuiti
// ---------------------------------------------------------------------------------------
//
// Due o più esercizi che si fanno di fila senza recupero in mezzo. Si esprimono con un
// campo `gruppo` sull'esercizio: chi ha la stessa lettera sta nello stesso giro. Una
// lettera e non un identificativo perché è così che un PT le scrive sul foglio — A1, A2 —
// e perché rende leggibile il jsonb quando si va a guardarlo.

const LETTERE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Gli esercizi di una routine divisi nei giri in cui vanno eseguiti.
 *
 * Restituisce sempre la stessa forma — un elenco di gruppi — anche quando nessuno è in
 * superset: così chi disegna non deve tenere due strade, una per gli esercizi soli e una
 * per quelli raggruppati.
 *
 * Solo esercizi **adiacenti** con la stessa lettera fanno gruppo: la posizione nella
 * routine è l'ordine di esecuzione, e due esercizi marcati "A" ma separati da altri non
 * sono un superset, sono un errore di compilazione che non va nascosto.
 */
export function raggruppaPerSuperset(esercizi) {
  const gruppi = [];
  (esercizi ?? []).forEach((esercizio, indice) => {
    const ultimo = gruppi[gruppi.length - 1];
    if (esercizio.gruppo && ultimo?.gruppo === esercizio.gruppo) {
      ultimo.esercizi.push({ esercizio, indice });
    } else {
      gruppi.push({ gruppo: esercizio.gruppo ?? null, esercizi: [{ esercizio, indice }] });
    }
  });
  return gruppi;
}

/** La prima lettera libera, per creare un gruppo nuovo. */
export function prossimaLetteraGruppo(esercizi) {
  const usate = new Set((esercizi ?? []).map((e) => e.gruppo).filter(Boolean));
  return [...LETTERE].find((l) => !usate.has(l)) ?? "A";
}

/** Se un esercizio è l'ultimo del suo giro: è lì che parte il recupero, non prima. */
export function ultimoDelGiro(esercizi, indice) {
  const corrente = esercizi?.[indice];
  if (!corrente?.gruppo) return true;
  const successivo = esercizi[indice + 1];
  return successivo?.gruppo !== corrente.gruppo;
}

// ---------------------------------------------------------------------------------------
// Record e progressi
// ---------------------------------------------------------------------------------------

/**
 * Il massimale stimato da una serie, con la formula di Epley.
 *
 * `kg × (1 + reps/30)` è la stima più diffusa e resta ragionevole entro le dieci
 * ripetizioni; oltre, sovrastima — ed è il motivo per cui sopra le dodici non la si mostra
 * invece di dare un numero in cui nessuno crederebbe.
 */
export function massimaleStimato(peso, reps) {
  const kg = Number(peso);
  const ripetizioni = Number(reps);
  if (!Number.isFinite(kg) || !Number.isFinite(ripetizioni)) return null;
  if (kg <= 0 || ripetizioni <= 0 || ripetizioni > 12) return null;
  return Math.round(kg * (1 + ripetizioni / 30) * 10) / 10;
}

/**
 * Il record per ogni esercizio, dalle serie registrate.
 *
 * Il record è la serie col massimale stimato più alto, non il peso più alto: 100kg×1 e
 * 80kg×8 sono due prestazioni diverse, e la seconda è la migliore delle due. Confrontare
 * i soli chili premierebbe una singola tirata a caso sopra un lavoro serio.
 */
export function recordPerEsercizio(righe) {
  const per = new Map();
  for (const riga of righe ?? []) {
    if (!tipoSerie(riga.tipo_serie ?? riga.tipo).volume) continue;
    const stimato = massimaleStimato(riga.peso_usato ?? riga.kg, riga.reps_fatte ?? riga.reps);
    if (stimato === null) continue;
    const corrente = per.get(riga.exercise_name);
    if (!corrente || stimato > corrente.massimale) {
      per.set(riga.exercise_name, {
        massimale: stimato,
        peso: Number(riga.peso_usato ?? riga.kg),
        reps: Number(riga.reps_fatte ?? riga.reps),
        data: riga.data,
      });
    }
  }
  return per;
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
