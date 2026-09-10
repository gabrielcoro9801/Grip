import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import TimerRecupero from "@/components/allenamento/TimerRecupero";
import { ChevronDown, Plus, Check, Timer, Trash2, StickyNote } from "lucide-react";
import { etichettaGruppo } from "@/lib/gruppiMuscolari";
import { formatDurata, formatRecupero } from "@/lib/scheda";
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
  const [precedenti, setPrecedenti] = useState(new Map());

  // Lo stato di lavoro: per ogni esercizio, le sue righe di serie.
  //   riga = { reps_previste, rpe_previsto, kg, reps, rpe, fatta, logId }
  const [esercizi, setEsercizi] = useState([]);
  const [noteEsercizi, setNoteEsercizi] = useState({});

  const [adesso, setAdesso] = useState(Date.now());
  const [recupero, setRecupero] = useState(null); // { scadenza, durataSecondi }
  const [chiusuraInCorso, setChiusuraInCorso] = useState(false);

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

      const [scheda, catalogo, registrate] = await Promise.all([
        api.entities.ExercisePlan.get(sessioneCorrente.plan_id),
        api.entities.Exercise.list(),
        api.entities.WorkoutLog.filter({ member_id: memberUser.member_id }, "-data", 500),
      ]);

      setDescrizioni(new Map(catalogo.map((e) => [e.id, e.description])));

      const routineCorrente = (scheda.routines ?? [])[sessioneCorrente.routine_index];
      if (!routineCorrente) {
        throw new Error(
          "La routine di questo allenamento non esiste più nella scheda: probabilmente è stata modificata dal tuo istruttore."
        );
      }
      setRoutine({ ...routineCorrente, planName: scheda.name });

      // Quello che si è fatto l'ultima volta, serie per serie. È il riferimento su cui si
      // decide il carico di oggi: senza, ogni allenamento riparte da un campo vuoto e da
      // uno sforzo di memoria.
      const diQuestaSessione = registrate.filter((r) => r.session_id === sessionId);
      const primaDiOggi = registrate.filter(
        (r) => r.session_id && r.session_id !== sessionId && r.plan_id === sessioneCorrente.plan_id
      );
      const perPosizione = new Map();
      for (const riga of primaDiOggi) {
        // `registrate` arriva in ordine di data decrescente: la prima che si incontra per
        // una posizione è la più recente.
        const chiave = `${riga.exercise_name}__${riga.set_index}`;
        if (!perPosizione.has(chiave)) perPosizione.set(chiave, riga);
      }
      setPrecedenti(perPosizione);

      // Le serie previste dalla scheda, più quelle già spuntate in questa sessione: è così
      // che un allenamento interrotto si riapre esattamente dov'era.
      setEsercizi(
        (routineCorrente.esercizi ?? []).map((esercizio, indiceEsercizio) => {
          const gia = diQuestaSessione.filter((r) => r.exercise_index === indiceEsercizio);
          const quanteRighe = Math.max(
            esercizio.serie?.length ?? 0,
            // Se l'ultima volta si erano aggiunte serie oltre quelle previste, le righe in
            // più devono ricomparire, non sparire.
            ...gia.map((r) => (r.set_index ?? 0) + 1),
            0
          );
          return {
            ...esercizio,
            righe: Array.from({ length: quanteRighe }, (_, indiceSerie) => {
              const prevista = esercizio.serie?.[indiceSerie];
              const registrata = gia.find((r) => r.set_index === indiceSerie);
              return {
                reps_previste: prevista?.reps ?? "",
                rpe_previsto: prevista?.rpe ?? null,
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
    const esercizio = esercizi[indiceEsercizio];
    const riga = esercizio.righe[indiceSerie];

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
        exercise_index: indiceEsercizio,
        set_index: indiceSerie,
        exercise_name: esercizio.exercise_name,
        muscle_group: esercizio.muscle_group ?? "",
        peso_usato: numero(riga.kg),
        reps_fatte: repsFatte,
        rpe_percepito: numero(riga.rpe) ?? riga.rpe_previsto ?? null,
        data: new Date().toISOString().split("T")[0],
        note: noteEsercizi[indiceEsercizio] ?? "",
      });
      cambiaRiga(indiceEsercizio, indiceSerie, "logId", creato.id);

      // Il recupero parte da solo: è il momento in cui serve, ed è anche l'unico momento
      // in cui nessuno ha voglia di cercare un pulsante.
      if (esercizio.recupero_secondi > 0) {
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
    let serieFatte = 0;
    let volume = 0;
    for (const esercizio of esercizi) {
      for (const riga of esercizio.righe) {
        if (!riga.fatta) continue;
        serieFatte += 1;
        // Il volume è carico × ripetizioni, sommato: è la misura con cui si confronta un
        // allenamento con quello di sette giorni fa. A corpo libero resta zero, e va bene:
        // non c'è un carico da contare.
        volume += (numero(riga.kg) ?? 0) * (numero(riga.reps) ?? 0);
      }
    }
    const serieTotali = esercizi.reduce((somma, es) => somma + es.righe.length, 0);
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
      toast({
        title: "Allenamento registrato",
        description: `${formatDurata(durataSecondi)} · ${statistiche.serieFatte} serie`,
      });
      navigate("/member-portal/allenamento");
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

  if (caricamento) return <LoadingState minHeight="h-screen" />;
  if (errore) return <div className="p-4"><ErrorState error={errore} onRetry={carica} /></div>;
  if (!sessione || !routine) return null;

  const giaChiusa = Boolean(sessione.terminata_alle);

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
              <p className="font-heading font-semibold text-sm truncate">{routine.nome}</p>
              <p className="text-xs text-muted-foreground truncate">{routine.planName}</p>
            </div>
            {!giaChiusa && (
              <Button
                size="sm"
                onClick={termina}
                disabled={chiusuraInCorso}
              >
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
        {routine.note && (
          <p className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">{routine.note}</p>
        )}

        {esercizi.map((esercizio, indiceEsercizio) => {
          const descrizione = descrizioni.get(esercizio.exercise_id);
          return (
            <section key={indiceEsercizio}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <h2 className="font-semibold text-primary">{esercizio.exercise_name}</h2>
                  <Badge variant="outline" className="text-[10px] font-normal mt-1">
                    {etichettaGruppo(esercizio.muscle_group)}
                  </Badge>
                </div>
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
              {!giaChiusa && (
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
                            <span className={cn(
                              "flex items-center justify-center h-9 w-9 rounded-lg text-sm font-semibold tabular-nums",
                              riga.fatta ? "bg-success/20 text-success" : "bg-muted"
                            )}>
                              {indiceSerie + 1}
                            </span>
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
                              type="number" inputMode="decimal" step="0.5" disabled={giaChiusa}
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
                              type="number" inputMode="numeric" disabled={giaChiusa}
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
                              type="number" inputMode="decimal" min="1" max="10" step="0.5" disabled={giaChiusa}
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
                              disabled={giaChiusa}
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

              {!giaChiusa && (
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
            </section>
          );
        })}

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

      {dialogoConferma}
    </div>
  );
}
