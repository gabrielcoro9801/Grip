import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/shared/Spinner";
import { ErrorState } from "@/components/shared/StateViews";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import TimerRecupero from "@/components/allenamento/TimerRecupero";
import SelettoreEsercizi from "@/components/allenamento/SelettoreEsercizi";
import { ChevronDown, Plus, Check, Timer, Trash2, StickyNote, Repeat, X } from "lucide-react";
import { etichettaGruppo } from "@/lib/gruppiMuscolari";
import {
  formatDurata, formatRecupero, statisticheAllenamento, tipoSerie, TIPI_SERIE,
  ultimoDelGiro, massimaleStimato, recordPerEsercizio,
} from "@/lib/scheda";
import { cn } from "@/lib/utils";

/**
 * L'allenamento mentre lo si fa.
 *
 * È una schermata d'uso, non di consultazione: si tiene il telefono in una mano fra una
 * serie e l'altra, quindi conta più il pollice che l'occhio — righe alte, un tocco per
 * spuntare una serie, e il recupero che parte da solo quando la spunti.
 *
 * Ogni serie spuntata viene scritta subito sul server, non alla fine: in palestra il
 * telefono si blocca, la pagina viene scaricata dalla memoria, la connessione va e viene.
 * Un allenamento tenuto tutto in memoria fino al "Termina" è un allenamento che prima o
 * poi si perde per intero — e con esso l'unico motivo per cui qualcuno lo stava
 * registrando.
 */
export default function SessioneAllenamento() {
  const { id: sessionId } = useParams();
  const navigate = useNavigate();
  const { memberUser } = useMemberAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();

  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);
  const [sessione, setSessione] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [descrizioni, setDescrizioni] = useState(new Map());
  const [immagini, setImmagini] = useState(new Map());
  // Il catalogo intero serve al selettore, quando si sostituisce o si aggiunge in sala.
  const [catalogo, setCatalogo] = useState([]);
  const [precedenti, setPrecedenti] = useState(new Map());
  const [record, setRecord] = useState(new Map());

  // Lo stato di lavoro: per ogni esercizio, le sue righe di serie.
  //   riga = { reps_previste, rpe_previsto, kg, reps, rpe, fatta, logId }
  const [esercizi, setEsercizi] = useState([]);
  const [noteEsercizi, setNoteEsercizi] = useState({});

  const [adesso, setAdesso] = useState(Date.now());
  const [recupero, setRecupero] = useState(null); // { scadenza, durataSecondi }
  const [chiusuraInCorso, setChiusuraInCorso] = useState(false);

  // Un allenamento già chiuso si apre in lettura e si sblocca solo chiedendolo: correggere
  // per sbaglio uno storico che si stava soltanto guardando è più facile di quanto sembri.
  const [modificaAttiva, setModificaAttiva] = useState(false);
  // I record battuti oggi, per il riepilogo finale.
  const [recordBattuti, setRecordBattuti] = useState([]);
  const [riepilogo, setRiepilogo] = useState(null);
  // null | { modo: "aggiungi" } | { modo: "sostituisci", indice }
  const [selettore, setSelettore] = useState(null);

  // Le righe con una scrittura in volo, per non spuntarle due volte.
  //
  // Un ref e non uno stato: due tocchi ravvicinati arrivano nello stesso ciclo di React e
  // leggerebbero lo stesso valore di uno stato, cioè il guardiano non li vedrebbe. Il ref
  // cambia subito, e il secondo tocco lo trova già alzato.
  //
  // Senza, il doppio tocco lasciava una serie registrata sul server che a schermo
  // risultava non fatta: il primo tocco accende la spunta e lancia la POST, il secondo
  // entra nel ramo "togli la spunta" mentre l'identificativo non è ancora tornato, quindi
  // non cancella niente — e la POST atterra dopo.
  const scrittureInCorso = useRef(new Set());

  // Un tick al secondo muove sia la durata sia il conto alla rovescia. Entrambi si
  // ricavano da un istante salvato, non da un contatore che scala: così restano esatti
  // anche se il telefono ha sospeso la pagina per dieci minuti.
  useEffect(() => {
    const intervallo = setInterval(() => setAdesso(Date.now()), 1000);
    return () => clearInterval(intervallo);
  }, []);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const sessioneCorrente = await api.entities.WorkoutSession.get(sessionId);
      setSessione(sessioneCorrente);

      const [scheda, catalogo, registrate, sessioniDelSocio] = await Promise.all([
        api.entities.ExercisePlan.get(sessioneCorrente.plan_id),
        api.entities.Exercise.list(),
        // Filtrato per scheda lato server: senza, si scaricava tutto lo storico del socio
        // per poi tenerne le prime 500 righe, e dopo qualche mese il "precedente" spariva
        // in silenzio perché era finito oltre il taglio.
        api.entities.WorkoutLog.filter(
          { member_id: memberUser.member_id, plan_id: sessioneCorrente.plan_id },
          "-data",
          1000
        ),
        api.entities.WorkoutSession.filter({ member_id: memberUser.member_id }, "-iniziata_alle", 200),
      ]);

      setCatalogo(catalogo);
      setDescrizioni(new Map(catalogo.map((e) => [e.id, e.description])));
      setImmagini(new Map(catalogo.filter((e) => e.image_url).map((e) => [e.id, e.image_url])));

      // La routine può non esserci più: l'istruttore ha modificato la scheda mentre
      // l'allenamento era aperto. Non è un errore da schermata bianca — fermarsi qui
      // renderebbe la sessione impossibile da chiudere, e il socio resterebbe con un
      // allenamento in corso per sempre. Si mostra quello che ha registrato e lo si lascia
      // chiudere.
      const routineCorrente = (scheda.routines ?? [])[sessioneCorrente.routine_index] ?? null;
      setRoutine(routineCorrente);

      const diQuestaSessione = registrate.filter((r) => r.session_id === sessionId);

      // Quello che si è fatto l'ultima volta, serie per serie. È il riferimento su cui si
      // decide il carico di oggi: senza, ogni allenamento riparte da un campo vuoto e da
      // uno sforzo di memoria.
      //
      // Il "quando" si prende dalla sessione e non dalla riga: `data` è una DATE senza ora,
      // quindi due allenamenti dello stesso giorno si ordinerebbero a caso e il
      // "precedente" potrebbe essere il più vecchio dei due. `iniziata_alle` è un istante
      // vero.
      //
      // E si guarda solo la **stessa routine**: lo stesso esercizio può stare in due
      // giornate diverse con carichi diversi, e mescolarle darebbe un riferimento che non
      // è mai stato eseguito in quella giornata.
      const passate = sessioniDelSocio
        .filter(
          (s) =>
            s.id !== sessionId &&
            s.plan_id === sessioneCorrente.plan_id &&
            s.routine_index === sessioneCorrente.routine_index
        )
        .sort((a, b) => new Date(b.iniziata_alle) - new Date(a.iniziata_alle));

      const perSessione = new Map();
      for (const riga of registrate) {
        if (!riga.session_id) continue;
        if (!perSessione.has(riga.session_id)) perSessione.set(riga.session_id, []);
        perSessione.get(riga.session_id).push(riga);
      }

      const perPosizione = new Map();
      for (const passata of passate) {
        for (const riga of perSessione.get(passata.id) ?? []) {
          const chiave = `${riga.exercise_name}__${riga.set_index}`;
          // Le sessioni sono ordinate dalla più recente: la prima che scrive una posizione
          // è quella che vince.
          if (!perPosizione.has(chiave)) perPosizione.set(chiave, riga);
        }
      }
      setPrecedenti(perPosizione);

      // I record di partenza: tutto quello che il socio ha gia registrato su questa
      // scheda, tolto quello che sta facendo adesso — altrimenti la prima serie di oggi
      // si confronterebbe con se stessa e non sarebbe mai un record.
      setRecord(recordPerEsercizio(registrate.filter((r) => r.session_id !== sessionId)));

      // Le serie previste dalla scheda, più quelle già spuntate in questa sessione: è così
      // che un allenamento interrotto si riapre esattamente dov'era.
      //
      // Le posizioni sono l'unione di quelle previste dalla scheda e di quelle che compaiono
      // fra le righe registrate: chi si allena può aggiungere un esercizio o sostituirne
      // uno perché la macchina era occupata, e quella deviazione deve ricomparire alla
      // riapertura. Se la routine non c'è più, restano solo le righe registrate.
      const previsti = routineCorrente?.esercizi ?? [];
      const indiciRegistrati = [...new Set(diQuestaSessione.map((r) => r.exercise_index ?? 0))];
      const posizioni = [...new Set([...previsti.map((_, i) => i), ...indiciRegistrati])]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)
        .map((indice) => {
          const daScheda = previsti[indice];
          const registrata = diQuestaSessione.find((r) => r.exercise_index === indice);
          return {
            indice,
            esercizio: {
              ...(daScheda ?? {
                exercise_id: null,
                recupero_secondi: null,
                note: "",
                serie: [],
              }),
              // Il nome registrato vince su quello della scheda: se l'esercizio è stato
              // sostituito in sala, l'allenamento racconta cosa è stato fatto davvero.
              exercise_name: registrata?.exercise_name ?? daScheda?.exercise_name ?? "Esercizio",
              muscle_group: registrata?.muscle_group || daScheda?.muscle_group || "altro",
            },
          };
        });

      setEsercizi(
        posizioni.map(({ esercizio, indice: indiceEsercizio }) => {
          const gia = diQuestaSessione.filter((r) => r.exercise_index === indiceEsercizio);
          // `posizione` è l'indice con cui le serie sono registrate, e non cambia mai. La
          // posizione nell'array invece si sposta appena si toglie un esercizio: usarla
          // per scrivere aggancerebbe le serie successive all'esercizio sbagliato.
          const posizione = indiceEsercizio;
          const quanteRighe = Math.max(
            esercizio.serie?.length ?? 0,
            // Se l'ultima volta si erano aggiunte serie oltre quelle previste, le righe in
            // più devono ricomparire, non sparire.
            ...gia.map((r) => (r.set_index ?? 0) + 1),
            0
          );
          return {
            ...esercizio,
            posizione,
            righe: Array.from({ length: quanteRighe }, (_, indiceSerie) => {
              const prevista = esercizio.serie?.[indiceSerie];
              const registrata = gia.find((r) => r.set_index === indiceSerie);
              return {
                reps_previste: prevista?.reps ?? "",
                rpe_previsto: prevista?.rpe ?? null,
                tipo: registrata?.tipo_serie ?? prevista?.tipo ?? "normale",
                kg: registrata?.peso_usato != null ? String(registrata.peso_usato) : "",
                reps: registrata?.reps_fatte != null ? String(registrata.reps_fatte) : "",
                rpe: registrata?.rpe_percepito != null ? String(registrata.rpe_percepito) : "",
                fatta: Boolean(registrata),
                logId: registrata?.id ?? null,
              };
            }),
          };
        })
      );
      // Le note scritte durante una sessione interrotta tornano nel campo da cui erano
      // state scritte, invece di sparire alla riapertura.
      const noteRiprese = {};
      for (const riga of diQuestaSessione) {
        if (riga.note && riga.exercise_index != null) noteRiprese[riga.exercise_index] = riga.note;
      }
      setNoteEsercizi(noteRiprese);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, [sessionId, memberUser]);

  useEffect(() => { carica(); }, [carica]);

  const cambiaRiga =(indiceEsercizio, indiceSerie, campo, valore) => {
    setEsercizi((precedenti) =>
      precedenti.map((es, i) =>
        i !== indiceEsercizio
          ? es
          : {
              ...es,
              righe: es.righe.map((r, j) => (j === indiceSerie ? { ...r, [campo]: valore } : r)),
            }
      )
    );
  };

  /** Il valore da salvare per una riga: numero o null, mai stringa vuota. */
  const numero = (testo) => {
    if (testo === "" || testo === null || testo === undefined) return null;
    const n = Number(String(testo).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const spuntaSerie = async (indiceEsercizio, indiceSerie) => {
    const chiave = `${indiceEsercizio}__${indiceSerie}`;
    // Un tocco mentre la scrittura precedente è ancora in volo non fa niente: è quasi
    // sempre il rimbalzo di un dito su uno schermo, mai un'intenzione.
    if (scrittureInCorso.current.has(chiave)) return;

    const esercizio = esercizi[indiceEsercizio];
    const riga = esercizio.righe[indiceSerie];
    scrittureInCorso.current.add(chiave);
    try {
      await eseguiSpunta(indiceEsercizio, indiceSerie, esercizio, riga);
    } finally {
      scrittureInCorso.current.delete(chiave);
    }
  };

  const eseguiSpunta = async (indiceEsercizio, indiceSerie, esercizio, riga) => {
    if (riga.fatta) {
      // Togliere la spunta cancella la registrazione: la serie non è stata fatta, e
      // lasciarla scritta significherebbe un allenamento che dice il falso.
      cambiaRiga(indiceEsercizio, indiceSerie, "fatta", false);
      if (riga.logId) {
        try {
          await api.entities.WorkoutLog.delete(riga.logId);
          cambiaRiga(indiceEsercizio, indiceSerie, "logId", null);
        } catch (err) {
          cambiaRiga(indiceEsercizio, indiceSerie, "fatta", true);
          toast({ title: "Non è stato possibile annullare la serie", description: err.message, variant: "destructive" });
        }
      }
      return;
    }

    // La spunta si accende subito e la scrittura parte dopo: aspettare la rete per vedere
    // il segno di spunta rende la schermata inutilizzabile con la linea della palestra.
    cambiaRiga(indiceEsercizio, indiceSerie, "fatta", true);
    // Le ripetizioni lasciate in bianco valgono quelle previste: se non le hai corrette,
    // hai fatto quelle scritte.
    const repsFatte = numero(riga.reps) ?? numero(riga.reps_previste);
    if (riga.reps === "" && repsFatte !== null) {
      cambiaRiga(indiceEsercizio, indiceSerie, "reps", String(repsFatte));
    }

    try {
      const creato = await api.entities.WorkoutLog.create({
        member_id: memberUser.member_id,
        plan_id: sessione.plan_id,
        plan_name: sessione.plan_name,
        session_id: sessionId,
        exercise_index: esercizio.posizione,
        set_index: indiceSerie,
        exercise_name: esercizio.exercise_name,
        muscle_group: esercizio.muscle_group ?? "",
        // Il tipo si congela qui: se domani il PT trasforma quel riscaldamento in una serie
        // di lavoro, gli allenamenti già fatti non devono ricalcolarsi da soli.
        tipo_serie: riga.tipo ?? "normale",
        peso_usato: numero(riga.kg),
        reps_fatte: repsFatte,
        rpe_percepito: numero(riga.rpe) ?? riga.rpe_previsto ?? null,
        data: new Date().toISOString().split("T")[0],
        note: noteEsercizi[indiceEsercizio] ?? "",
      });
      cambiaRiga(indiceEsercizio, indiceSerie, "logId", creato.id);

      segnalaRecord(esercizio, riga, repsFatte);

      // Il recupero parte da solo: è il momento in cui serve, ed è anche l'unico momento
      // in cui nessuno ha voglia di cercare un pulsante.
      //
      // Ma non in mezzo a un superset: A1 e A2 si fanno di fila senza pausa, e un timer
      // che parte dopo A1 direbbe l'esatto contrario di quello che c'è scritto in scheda.
      if (esercizio.recupero_secondi > 0 && ultimoDelGiro(esercizi, indiceEsercizio)) {
        setRecupero({
          scadenza: Date.now() + esercizio.recupero_secondi * 1000,
          durataSecondi: esercizio.recupero_secondi,
        });
      }
    } catch (err) {
      cambiaRiga(indiceEsercizio, indiceSerie, "fatta", false);
      toast({ title: "Serie non registrata", description: err.message, variant: "destructive" });
    }
  };

  /**
   * Se la serie appena chiusa è la migliore di sempre su quell'esercizio, dirlo.
   *
   * È l'unico momento in cui la notizia vale qualcosa: darla a fine allenamento, in un
   * riepilogo, significa darla quando la fatica è già passata. Il confronto è sul
   * massimale stimato e non sui chili, perché 80×8 vale più di 100×1.
   */
  const segnalaRecord = (esercizio, riga, repsFatte) => {
    const adessoStimato = massimaleStimato(numero(riga.kg), repsFatte);
    if (adessoStimato === null) return;
    const precedente = record.get(esercizio.exercise_name);
    if (precedente && adessoStimato <= precedente.massimale) return;

    setRecord((precedenti) => {
      const copia = new Map(precedenti);
      copia.set(esercizio.exercise_name, {
        massimale: adessoStimato,
        peso: numero(riga.kg),
        reps: repsFatte,
        data: new Date().toISOString().split("T")[0],
      });
      return copia;
    });
    // Tenuti da parte per il riepilogo di fine seduta: uno stesso esercizio può battere
    // il record due volte, e nel riepilogo deve comparire una volta sola, col migliore.
    setRecordBattuti((precedenti) => [
      ...precedenti.filter((r) => r.nome !== esercizio.exercise_name),
      { nome: esercizio.exercise_name, peso: numero(riga.kg), reps: repsFatte, massimale: adessoStimato },
    ]);
    toast({
      title: `Record su ${esercizio.exercise_name}`,
      description: precedente
        ? `${numero(riga.kg)}kg × ${repsFatte} — meglio di ${precedente.peso}kg × ${precedente.reps}.`
        : `${numero(riga.kg)}kg × ${repsFatte}. È la prima volta che lo registri.`,
    });
  };

  /** Una serie già spuntata che viene corretta va riscritta anche sul server. */
  const salvaCorrezione = async (indiceEsercizio, indiceSerie) => {
    const riga = esercizi[indiceEsercizio]?.righe[indiceSerie];
    if (!riga?.fatta || !riga.logId) return;
    try {
      await api.entities.WorkoutLog.update(riga.logId, {
        peso_usato: numero(riga.kg),
        reps_fatte: numero(riga.reps),
        rpe_percepito: numero(riga.rpe),
        note: noteEsercizi[indiceEsercizio] ?? "",
      });
    } catch (err) {
      toast({ title: "Correzione non salvata", description: err.message, variant: "destructive" });
    }
  };

  /**
   * Fa girare il tipo di una serie fra i quattro possibili.
   *
   * A rotazione e non con un menu: sono quattro voci, il gesto è uno solo, e in sala
   * un menu a tendina su un pulsante da nove millimetri è un bersaglio che si manca.
   * Se la serie è già registrata, la correzione va anche sul server.
   */
  const ruotaTipoSerie = (indiceEsercizio, indiceSerie) => {
    const codici = Object.keys(TIPI_SERIE);
    const riga = esercizi[indiceEsercizio].righe[indiceSerie];
    const prossimo = codici[(codici.indexOf(riga.tipo ?? "normale") + 1) % codici.length];
    cambiaRiga(indiceEsercizio, indiceSerie, "tipo", prossimo);
    if (riga.fatta && riga.logId) {
      api.entities.WorkoutLog.update(riga.logId, { tipo_serie: prossimo }).catch((err) => {
        toast({ title: "Tipo non salvato", description: err.message, variant: "destructive" });
      });
    }
  };

  const aggiungiSerie = (indiceEsercizio) => {
    setEsercizi((precedenti) =>
      precedenti.map((es, i) => {
        if (i !== indiceEsercizio) return es;
        const ultima = es.righe[es.righe.length - 1];
        return {
          ...es,
          righe: [
            ...es.righe,
            {
              // La serie in più ricalca l'ultima fatta: si aggiunge una serie quando si
              // vuole farne un'altra uguale, non una diversa.
              reps_previste: ultima?.reps || ultima?.reps_previste || "",
              rpe_previsto: ultima?.rpe_previsto ?? null,
              // Una serie aggiunta è quasi sempre di lavoro, anche se l'ultima era un
              // riscaldamento: si aggiunge una serie perché se ne vuole fare una in più,
              // non per scaldarsi ancora.
              tipo: "normale",
              kg: ultima?.kg ?? "",
              reps: "",
              rpe: "",
              fatta: false,
              logId: null,
            },
          ],
        };
      })
    );
  };

  /**
   * Sostituisce un esercizio con un altro, o ne aggiunge uno che non era previsto.
   *
   * Serve perché la sala non è la scheda: la macchina è occupata, il manubrio da 24 non
   * c'è, la spalla non gradisce. Senza questa via, l'unica scelta era saltare l'esercizio
   * o registrare sotto un nome sbagliato quello che si è fatto davvero.
   *
   * La scheda non viene toccata: la deviazione vive nell'allenamento, e la prossima volta
   * si riparte da quello che il personal trainer ha scritto.
   */
  const applicaSelettore = async (scelti) => {
    const scelto = scelti[0];
    if (!scelto) return;

    if (selettore?.modo === "aggiungi") {
      setEsercizi((precedenti) => [
        ...precedenti,
        {
          // Una posizione nuova, oltre tutte quelle esistenti: non deve accavallarsi a
          // quella di un esercizio previsto dalla scheda.
          posizione: Math.max(-1, ...precedenti.map((e) => e.posizione ?? -1)) + 1,
          exercise_id: scelto.id,
          exercise_name: scelto.name,
          muscle_group: scelto.muscle_group ?? "altro",
          recupero_secondi: null,
          note: "",
          serie: [],
          righe: [{ reps_previste: "", rpe_previsto: null, tipo: "normale", kg: "", reps: "", rpe: "", fatta: false, logId: null }],
        },
      ]);
      return;
    }

    const indice = selettore.indice;
    const esercizio = esercizi[indice];
    setEsercizi((precedenti) =>
      precedenti.map((es, i) =>
        i === indice
          ? { ...es, exercise_id: scelto.id, exercise_name: scelto.name, muscle_group: scelto.muscle_group ?? "altro" }
          : es
      )
    );
    // Le serie già spuntate vanno intestate al nuovo esercizio, o lo storico direbbe di
    // aver fatto qualcosa che non si è fatto.
    for (const riga of esercizio.righe.filter((r) => r.logId)) {
      try {
        await api.entities.WorkoutLog.update(riga.logId, {
          exercise_name: scelto.name,
          muscle_group: scelto.muscle_group ?? "altro",
        });
      } catch (err) {
        toast({ title: "Sostituzione non salvata del tutto", description: err.message, variant: "destructive" });
      }
    }
  };

  const togliEsercizio = async (indiceEsercizio) => {
    const esercizio = esercizi[indiceEsercizio];
    const registrate = esercizio.righe.filter((r) => r.logId);
    const ok = await conferma({
      title: `Togliere ${esercizio.exercise_name} da questo allenamento?`,
      description: registrate.length
        ? `Le ${registrate.length} ${registrate.length === 1 ? "serie registrata" : "serie registrate"} vengono cancellate. La scheda non cambia.`
        : "Non l'hai ancora iniziato. La scheda non cambia.",
      confirmLabel: "Togli",
      destructive: true,
    });
    if (!ok) return;
    for (const riga of registrate) {
      try {
        await api.entities.WorkoutLog.delete(riga.logId);
      } catch (err) {
        toast({ title: "Non è stato possibile togliere", description: err.message, variant: "destructive" });
        return;
      }
    }
    setEsercizi((precedenti) => precedenti.filter((_, i) => i !== indiceEsercizio));
  };

  const rimuoviSerie = async (indiceEsercizio, indiceSerie) => {
    const riga = esercizi[indiceEsercizio].righe[indiceSerie];
    if (riga.logId) {
      try {
        await api.entities.WorkoutLog.delete(riga.logId);
      } catch (err) {
        toast({ title: "Non è stato possibile eliminare la serie", description: err.message, variant: "destructive" });
        return;
      }
    }
    setEsercizi((precedenti) =>
      precedenti.map((es, i) =>
        i !== indiceEsercizio ? es : { ...es, righe: es.righe.filter((_, j) => j !== indiceSerie) }
      )
    );
  };

  const statistiche = useMemo(() => {
    // Il conto lo fa `statisticheAllenamento`, la stessa funzione che usa il personal
    // trainer per rileggere questo allenamento: se lo facessero in due modi diversi, prima
    // o poi i due vedrebbero due volumi diversi per la stessa seduta.
    const fatte = esercizi.flatMap((es) => es.righe.filter((r) => r.fatta));
    const { serie: serieFatte, volume } = statisticheAllenamento(fatte);
    // Le previste escludono il riscaldamento come le fatte, o il "3/8" a schermo
    // confronterebbe due misure diverse.
    const serieTotali = esercizi.reduce(
      (somma, es) => somma + es.righe.filter((r) => tipoSerie(r.tipo).volume).length,
      0
    );
    return { serieFatte, serieTotali, volume };
  }, [esercizi]);

  const durataSecondi = sessione
    ? Math.max(0, (adesso - new Date(sessione.iniziata_alle).getTime()) / 1000)
    : 0;

  const termina = async () => {
    const mancanti = statistiche.serieTotali - statistiche.serieFatte;
    const ok = await conferma({
      title: "Terminare l'allenamento?",
      description: mancanti
        ? `Ci sono ancora ${mancanti} ${mancanti === 1 ? "serie non spuntata" : "serie non spuntate"}: ` +
          "non verranno registrate. Le serie già fatte restano salvate."
        : "Hai completato tutte le serie previste.",
      confirmLabel: "Termina",
    });
    if (!ok) return;
    setChiusuraInCorso(true);
    try {
      await api.entities.WorkoutSession.update(sessionId, { terminata_alle: new Date().toISOString() });
      // Il riepilogo invece di uscire e basta: è il momento in cui la fatica diventa un
      // risultato che si vede, e i record battuti vanno detti quando contano.
      setRiepilogo({
        durata: durataSecondi,
        serie: statistiche.serieFatte,
        volume: statistiche.volume,
        record: recordBattuti,
      });
    } catch (err) {
      toast({ title: "Non è stato possibile chiudere l'allenamento", description: err.message, variant: "destructive" });
      setChiusuraInCorso(false);
    }
  };

  const esci = () => {
    // Uscire non chiude niente: la sessione resta aperta e si riprende da dov'era. È il
    // caso normale — si esce per guardare un messaggio, non per smettere di allenarsi.
    navigate("/member-portal/allenamento");
  };

  /**
   * Buttare via l'allenamento.
   *
   * Serve perché una sessione aperta impedisce di avviarne un'altra: senza questa via
   * d'uscita, un allenamento iniziato per sbaglio — o interrotto dopo due serie — bloccava
   * il socio per sempre, e l'unico rimedio era chiedere a qualcuno di intervenire sul
   * database.
   */
  const annulla = async () => {
    const chiuso = Boolean(sessione?.terminata_alle);
    const ok = await conferma({
      title: chiuso ? "Eliminare questo allenamento?" : "Annullare l'allenamento?",
      description: statistiche.serieFatte
        ? `Le ${statistiche.serieFatte} ${statistiche.serieFatte === 1 ? "serie registrata" : "serie registrate"} vengono cancellate. ` +
          (chiuso
            ? "Sparisce dallo storico, dal conteggio delle sedute e dai record."
            : "Non resta niente nello storico.")
        : "Non c'è niente di registrato: si cancella e basta.",
      confirmLabel: chiuso ? "Elimina" : "Annulla l'allenamento",
      destructive: true,
    });
    if (!ok) return;
    setChiusuraInCorso(true);
    try {
      // Prima le serie, poi la sessione: la chiave esterna punta da quelle a questa, e
      // togliendo prima la sessione il database rifiuterebbe.
      const daCancellare = esercizi.flatMap((es) => es.righe.filter((r) => r.logId).map((r) => r.logId));
      for (const logId of daCancellare) {
        await api.entities.WorkoutLog.delete(logId);
      }
      await api.entities.WorkoutSession.delete(sessionId);
      toast({ title: "Allenamento annullato" });
      navigate("/member-portal/allenamento");
    } catch (err) {
      toast({ title: "Non è stato possibile annullare", description: err.message, variant: "destructive" });
      setChiusuraInCorso(false);
    }
  };

  if (caricamento) return <LoadingState minHeight="h-screen" />;
  if (errore) return <div className="p-4"><ErrorState error={errore} onRetry={carica} /></div>;
  if (!sessione) return null;

  const giaChiusa = Boolean(sessione.terminata_alle);
  // Si compila mentre ci si allena, e su uno storico solo dopo aver chiesto di correggerlo.
  const bloccato = giaChiusa && !modificaAttiva;
  // La scheda è stata modificata mentre l'allenamento era aperto: si può ancora leggere e
  // chiudere quello che è stato fatto, ma non c'è più niente da eseguire.
  const routinePersa = !routine;

  return (
    <div className={cn("min-h-screen bg-background", recupero && "pb-24")}>
      {/* L'intestazione resta agganciata in alto: durata, volume e serie sono i numeri
          che si guardano di continuo, e "Termina" deve essere raggiungibile sempre. */}
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 px-3 h-14">
            <Button variant="ghost" size="icon" onClick={esci} aria-label="Torna all'elenco senza chiudere l'allenamento">
              <ChevronDown className="w-5 h-5" aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              {/* Nome della routine e della scheda dalla sessione, non dalla scheda: sono
                  copiati lì apposta, e restano leggibili anche se la scheda è cambiata. */}
              <p className="font-heading font-semibold text-sm truncate">{sessione.routine_name}</p>
              <p className="text-xs text-muted-foreground truncate">{sessione.plan_name}</p>
            </div>
            {/* Cancellare vale sempre, anche a seduta chiusa: un allenamento creato per
                sbaglio finisce nel volume, nel conteggio e nei record, e senza una via per
                toglierlo resterebbe lì a falsare i numeri per sempre. */}
            <Button
              variant="ghost" size="icon" className="text-destructive"
              onClick={annulla} disabled={chiusuraInCorso}
              aria-label={giaChiusa ? "Elimina questo allenamento dallo storico" : "Annulla l'allenamento"}
              title={giaChiusa ? "Elimina" : "Annulla l'allenamento"}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </Button>
            {giaChiusa ? (
              // Un allenamento chiuso si apre in lettura: si sblocca chiedendolo, così
              // guardando lo storico non si corregge niente per sbaglio.
              <Button
                size="sm"
                variant={modificaAttiva ? "default" : "outline"}
                onClick={() => setModificaAttiva((attiva) => !attiva)}
              >
                {modificaAttiva ? "Fine modifiche" : "Correggi"}
              </Button>
            ) : (
              <Button size="sm" onClick={termina} disabled={chiusuraInCorso}>
                Termina
              </Button>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-2 px-4 pb-3 border-t border-border pt-3">
            <div>
              <dt className="text-xs text-muted-foreground">Durata</dt>
              <dd className="text-base font-semibold text-primary tabular-nums">
                {giaChiusa
                  ? formatDurata((new Date(sessione.terminata_alle) - new Date(sessione.iniziata_alle)) / 1000)
                  : formatDurata(durataSecondi)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Volume</dt>
              <dd className="text-base font-semibold tabular-nums">
                {Math.round(statistiche.volume).toLocaleString("it-IT")} kg
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Serie</dt>
              <dd className="text-base font-semibold tabular-nums">
                {statistiche.serieFatte}<span className="text-muted-foreground text-sm">/{statistiche.serieTotali}</span>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-3 py-4 space-y-6">
        {routinePersa && (
          <p className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg p-3">
            Il tuo istruttore ha modificato la scheda mentre ti allenavi, e questa giornata
            non c'è più. Qui sotto trovi quello che avevi già registrato: puoi chiudere
            l'allenamento per conservarlo, oppure annullarlo.
          </p>
        )}

        {routine?.note && (
          <p className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">{routine.note}</p>
        )}

        {esercizi.map((esercizio, indiceEsercizio) => {
          const descrizione = descrizioni.get(esercizio.exercise_id);
          return (
            <section key={indiceEsercizio}>
              {/* Il superset si legge dal bordo che unisce gli esercizi del giro: A1 e A2
                  vanno fatti di fila, e devono sembrare una cosa sola. */}
              <div className={cn(
                esercizio.gruppo && "border-l-2 border-primary pl-3 -ml-px",
              )}>
              <div className="flex items-start gap-2.5 mb-1">
                {immagini.get(esercizio.exercise_id) && (
                  <img
                    src={immagini.get(esercizio.exercise_id)}
                    alt=""
                    loading="lazy"
                    className="w-11 h-11 rounded-lg object-cover bg-muted shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-primary">{esercizio.exercise_name}</h2>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {etichettaGruppo(esercizio.muscle_group)}
                    </Badge>
                    {esercizio.gruppo && (
                      <Badge className="text-[10px] font-normal">
                        Superset {esercizio.gruppo}
                        {!ultimoDelGiro(esercizi, indiceEsercizio) && " · poi il prossimo, senza pausa"}
                      </Badge>
                    )}
                  </div>
                </div>
                {/* La sala non è la scheda: la macchina è occupata, il manubrio non c'è.
                    Si sostituisce o si toglie l'esercizio senza toccare la scheda, che
                    resta com'è per la prossima volta. */}
                {!bloccato && (
                  <div className="flex items-center gap-0.5 shrink-0 -mr-2">
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      aria-label={`Sostituisci ${esercizio.exercise_name} con un altro esercizio`}
                      title="Sostituisci"
                      onClick={() => setSelettore({ modo: "sostituisci", indice: indiceEsercizio })}
                    >
                      <Repeat className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      aria-label={`Togli ${esercizio.exercise_name} da questo allenamento`}
                      title="Togli"
                      onClick={() => togliEsercizio(indiceEsercizio)}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>

              {/* La nota del personal trainer: si legge, non si tocca. */}
              {esercizio.note && (
                <p className="text-sm text-muted-foreground mb-1.5 flex items-start gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {esercizio.note}
                </p>
              )}

              {/* La nota di chi si allena, su questo allenamento: "spalla destra tirava",
                  "cambiata macchina". Finisce sulle serie registrate, così quando il
                  personal trainer guarda lo storico trova scritto anche il perché. */}
              {!bloccato && (
                <Input
                  className="h-8 text-sm mb-1.5 border-dashed"
                  value={noteEsercizi[indiceEsercizio] ?? ""}
                  onChange={(e) => setNoteEsercizi((n) => ({ ...n, [indiceEsercizio]: e.target.value }))}
                  onBlur={() => {
                    // Le serie già spuntate si riallineano alla nota appena scritta.
                    esercizio.righe.forEach((riga, indiceSerie) => {
                      if (riga.fatta) salvaCorrezione(indiceEsercizio, indiceSerie);
                    });
                  }}
                  placeholder="Aggiungi delle note qui…"
                  aria-label={`Note su ${esercizio.exercise_name}`}
                />
              )}

              {descrizione && (
                <details className="mb-1.5">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Come si esegue</summary>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{descrizione}</p>
                </details>
              )}

              <p className="text-sm text-primary mb-2 inline-flex items-center gap-1.5">
                <Timer className="w-4 h-4" aria-hidden="true" />
                Recupero: {esercizio.recupero_secondi > 0 ? formatRecupero(esercizio.recupero_secondi) : "non impostato"}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Serie di {esercizio.exercise_name}</caption>
                  <thead>
                    <tr className="text-[10px] uppercase text-muted-foreground">
                      <th scope="col" className="text-left font-medium pb-1 w-10">Serie</th>
                      <th scope="col" className="text-left font-medium pb-1 w-24">Precedente</th>
                      <th scope="col" className="text-center font-medium pb-1">Kg</th>
                      <th scope="col" className="text-center font-medium pb-1">Ripetizioni</th>
                      <th scope="col" className="text-center font-medium pb-1 w-16">RPE</th>
                      <th scope="col" className="pb-1 w-11"><span className="sr-only">Fatta</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {esercizio.righe.map((riga, indiceSerie) => {
                      const precedente = precedenti.get(`${esercizio.exercise_name}__${indiceSerie}`);
                      return (
                        <tr
                          key={indiceSerie}
                          className={cn("transition-colors", riga.fatta && "bg-success/10")}
                        >
                          <td className="py-1">
                            {/* Il numero della serie porta anche il tipo, e si tocca per
                                cambiarlo: capita di decidere in sala che una serie era
                                riscaldamento, e non deve costare l'apertura di un menu. */}
                            <button
                              type="button"
                              disabled={bloccato}
                              onClick={() => ruotaTipoSerie(indiceEsercizio, indiceSerie)}
                              aria-label={`Serie ${indiceSerie + 1}: ${tipoSerie(riga.tipo).etichetta}. Tocca per cambiare tipo.`}
                              className={cn(
                                "flex items-center justify-center h-9 w-9 rounded-lg text-sm font-semibold tabular-nums transition-colors disabled:opacity-60",
                                riga.fatta ? "bg-success/20 text-success" : "bg-muted",
                                tipoSerie(riga.tipo).sigla && !riga.fatta && "text-primary"
                              )}
                            >
                              {tipoSerie(riga.tipo).sigla || indiceSerie + 1}
                            </button>
                          </td>
                          <td className="py-1 pr-2 text-xs text-muted-foreground leading-tight">
                            {precedente ? (
                              <>
                                {precedente.peso_usato ? `${Number(precedente.peso_usato)}kg × ` : ""}
                                {precedente.reps_fatte ?? "—"}
                                {precedente.rpe_percepito ? <><br />@ {Number(precedente.rpe_percepito)} rpe</> : null}
                              </>
                            ) : (
                              <span className="opacity-60">
                                {riga.reps_previste ? `— × ${riga.reps_previste}` : "—"}
                              </span>
                            )}
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number" inputMode="decimal" step="0.5" disabled={bloccato}
                              className="h-9 text-center text-sm"
                              value={riga.kg}
                              onChange={(e) => cambiaRiga(indiceEsercizio, indiceSerie, "kg", e.target.value)}
                              onBlur={() => salvaCorrezione(indiceEsercizio, indiceSerie)}
                              placeholder={precedente?.peso_usato ? String(Number(precedente.peso_usato)) : "—"}
                              aria-label={`Peso della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number" inputMode="numeric" disabled={bloccato}
                              className="h-9 text-center text-sm"
                              value={riga.reps}
                              onChange={(e) => cambiaRiga(indiceEsercizio, indiceSerie, "reps", e.target.value)}
                              onBlur={() => salvaCorrezione(indiceEsercizio, indiceSerie)}
                              // Il previsto compare come suggerimento e non come valore:
                              // scritto per davvero, un numero mai toccato sembrerebbe una
                              // ripetizione confermata.
                              placeholder={riga.reps_previste || "—"}
                              aria-label={`Ripetizioni della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                            />
                          </td>
                          <td className="py-1 px-1">
                            <Input
                              type="number" inputMode="decimal" min="1" max="10" step="0.5" disabled={bloccato}
                              className="h-9 text-center text-sm"
                              value={riga.rpe}
                              onChange={(e) => cambiaRiga(indiceEsercizio, indiceSerie, "rpe", e.target.value)}
                              onBlur={() => salvaCorrezione(indiceEsercizio, indiceSerie)}
                              placeholder={riga.rpe_previsto != null ? String(riga.rpe_previsto) : "—"}
                              aria-label={`RPE della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                            />
                          </td>
                          <td className="py-1 pl-1">
                            <button
                              type="button"
                              disabled={bloccato}
                              onClick={() => spuntaSerie(indiceEsercizio, indiceSerie)}
                              aria-pressed={riga.fatta}
                              aria-label={`Segna come fatta la serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                              className={cn(
                                "h-9 w-9 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50",
                                riga.fatta
                                  ? "bg-success text-success-foreground"
                                  : "bg-muted text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <Check className="w-5 h-5" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!bloccato && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => aggiungiSerie(indiceEsercizio)}
                  >
                    <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi serie
                  </Button>
                  {esercizio.righe.length > 1 && (
                    <Button
                      variant="ghost" size="sm" className="text-muted-foreground"
                      aria-label={`Togli l'ultima serie di ${esercizio.exercise_name}`}
                      onClick={() => rimuoviSerie(indiceEsercizio, esercizio.righe.length - 1)}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
              </div>
            </section>
          );
        })}

        {!bloccato && (
          <Button variant="outline" className="w-full" onClick={() => setSelettore({ modo: "aggiungi" })}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi un esercizio
          </Button>
        )}

        {!giaChiusa && (
          <Button className="w-full" size="lg" onClick={termina} disabled={chiusuraInCorso}>
            Termina allenamento
          </Button>
        )}
      </div>

      {recupero && (
        <TimerRecupero
          scadenza={recupero.scadenza}
          durataSecondi={recupero.durataSecondi}
          adesso={adesso}
          onAggiungi={(secondi) =>
            setRecupero((r) => ({
              scadenza: r.scadenza + secondi * 1000,
              durataSecondi: r.durataSecondi + secondi,
            }))
          }
          onChiudi={() => setRecupero(null)}
        />
      )}

      <SelettoreEsercizi
        aperto={Boolean(selettore)}
        onChiudi={() => setSelettore(null)}
        esercizi={catalogo}
        onAggiungi={applicaSelettore}
      />

      {/* Il riepilogo di fine seduta: il momento in cui la fatica diventa un numero che si
          vede, e l'unico in cui i record battuti oggi valgono qualcosa. */}
      <Dialog
        open={Boolean(riepilogo)}
        onOpenChange={(aperto) => !aperto && navigate("/member-portal/allenamento")}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Allenamento finito</DialogTitle>
            <DialogDescription>{sessione.routine_name}</DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-3 gap-2 text-center py-2">
            <div>
              <dt className="text-xs text-muted-foreground">Durata</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatDurata(riepilogo?.durata ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Volume</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {Math.round(riepilogo?.volume ?? 0).toLocaleString("it-IT")}
                <span className="text-xs text-muted-foreground"> kg</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Serie</dt>
              <dd className="text-lg font-semibold tabular-nums">{riepilogo?.serie ?? 0}</dd>
            </div>
          </dl>

          {riepilogo?.record?.length > 0 && (
            <div className="rounded-lg bg-success/10 border border-success/20 p-3">
              <p className="text-sm font-semibold text-success mb-1">
                {riepilogo.record.length === 1 ? "Un record battuto" : `${riepilogo.record.length} record battuti`}
              </p>
              <ul className="space-y-0.5">
                {riepilogo.record.map((r) => (
                  <li key={r.nome} className="text-xs flex justify-between gap-2">
                    <span className="truncate">{r.nome}</span>
                    <span className="whitespace-nowrap tabular-nums">{r.peso}kg × {r.reps}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button className="w-full" onClick={() => navigate("/member-portal/allenamento")}>
            Chiudi
          </Button>
        </DialogContent>
      </Dialog>

      {dialogoConferma}
    </div>
  );
}
