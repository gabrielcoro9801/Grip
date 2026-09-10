import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ClipboardList, Play, Timer, ChevronDown, History, CalendarDays, Trophy } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/shared/Spinner";
import { EmptyState, ErrorState } from "@/components/shared/StateViews";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { formatData, formatDataOra } from "@/lib/format";
import { etichettaGruppo } from "@/lib/gruppiMuscolari";
import { formatRecupero, formatDurata, totaleSerie, riepilogoSerie, riepilogoRpe, recordPerEsercizio, statisticheSettimanali } from "@/lib/scheda";
import ProgressiEsercizio from "@/components/allenamento/ProgressiEsercizio";

export default function MemberWorkoutPlans() {
  const { memberUser } = useMemberAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [conferma, dialogoConferma] = useConfirm();

  const [schede, setSchede] = useState([]);
  const [sessioni, setSessioni] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);
  const [avvioInCorso, setAvvioInCorso] = useState(null);
  const [annullamentoInCorso, setAnnullamentoInCorso] = useState(false);
  const [righe, setRighe] = useState([]);
  const [esercizioAperto, setEsercizioAperto] = useState(null);

  const carica = useCallback(async () => {
    setErrore(null);
    try {
      const [s, ses, log] = await Promise.all([
        api.entities.ExercisePlan.filter({ member_id: memberUser.member_id }),
        api.entities.WorkoutSession.filter({ member_id: memberUser.member_id }, "-iniziata_alle", 50),
        api.entities.WorkoutLog.filter({ member_id: memberUser.member_id }, "-data", 1000),
      ]);
      setSchede(s);
      setSessioni(ses);
      setRighe(log);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, [memberUser]);

  useEffect(() => { carica(); }, [carica]);

  // Un allenamento lasciato aperto: il telefono si è bloccato, si è usciti per rispondere
  // a un messaggio. Va ritrovato in cima, o si finisce per avviarne un secondo e
  // spezzare in due lo stesso allenamento.
  const inCorso = useMemo(() => sessioni.find((s) => !s.terminata_alle), [sessioni]);
  const concluse = useMemo(() => sessioni.filter((s) => s.terminata_alle), [sessioni]);
  const andamento = useMemo(() => statisticheSettimanali(sessioni), [sessioni]);

  // I record, dal migliore al peggiore: in cima quello di cui si va piu fieri.
  const record = useMemo(
    () => [...recordPerEsercizio(righe).entries()]
      .map(([nome, migliore]) => ({ nome, migliore }))
      .sort((a, b) => b.migliore.massimale - a.migliore.massimale),
    [righe],
  );

  const annullaInCorso = async () => {
    const ok = await conferma({
      title: "Annullare l'allenamento in corso?",
      description: `«${inCorso.routine_name}» e tutto quello che ci hai registrato vengono cancellati.`,
      confirmLabel: "Annulla l'allenamento",
      destructive: true,
    });
    if (!ok) return;
    setAnnullamentoInCorso(true);
    try {
      // Prima le serie e poi la sessione: la chiave esterna punta da quelle a questa.
      const daCancellare = await api.entities.WorkoutLog.filter(
        { member_id: memberUser.member_id },
        "-data",
        1000
      );
      for (const riga of daCancellare.filter((r) => r.session_id === inCorso.id)) {
        await api.entities.WorkoutLog.delete(riga.id);
      }
      await api.entities.WorkoutSession.delete(inCorso.id);
      toast({ title: "Allenamento annullato" });
      await carica();
    } catch (err) {
      toast({ title: "Non è stato possibile annullare", description: err.message, variant: "destructive" });
    }
    setAnnullamentoInCorso(false);
  };

  const avvia = async (scheda, routine, indiceRoutine) => {
    if (inCorso) {
      toast({
        title: "Hai già un allenamento in corso",
        description: "Riprendilo o terminalo prima di avviarne un altro.",
        variant: "destructive",
      });
      return;
    }
    setAvvioInCorso(`${scheda.id}__${indiceRoutine}`);
    try {
      const sessione = await api.entities.WorkoutSession.create({
        member_id: memberUser.member_id,
        plan_id: scheda.id,
        plan_name: scheda.name,
        routine_index: indiceRoutine,
        routine_name: routine.nome,
        iniziata_alle: new Date().toISOString(),
      });
      navigate(`/member-portal/allenamento/sessione/${sessione.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile avviare", description: err.message, variant: "destructive" });
      setAvvioInCorso(null);
    }
  };

  if (caricamento) return <LoadingState minHeight="h-64" />;
  if (errore) return <div className="p-4"><ErrorState error={errore} onRetry={carica} /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Allenamento</h1>
        <p className="text-sm text-muted-foreground">Scegli la giornata da fare e avviala</p>
      </div>

      {/* Quante volte ci si è allenati: è la misura che fa tornare le persone, molto più
          di qualsiasi grafico. La fila di settimane è quella che nessuno vuole spezzare. */}
      {concluse.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Questa settimana</dt>
                <dd className="text-xl font-semibold tabular-nums">{andamento.questaSettimana}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Questo mese</dt>
                <dd className="text-xl font-semibold tabular-nums">{andamento.questoMese}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Settimane di fila</dt>
                <dd className="text-xl font-semibold tabular-nums text-primary">
                  {andamento.settimaneDiFila}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {inCorso && (
        <Card className="border-0 shadow-sm bg-primary/5 ring-1 ring-primary/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Allenamento in corso</p>
              <p className="text-xs text-muted-foreground truncate">
                {inCorso.routine_name} · {inCorso.plan_name} · iniziato {formatDataOra(inCorso.iniziata_alle)}
              </p>
            </div>
            <Button size="sm" onClick={() => navigate(`/member-portal/allenamento/sessione/${inCorso.id}`)}>
              Riprendi
            </Button>
            {/* La via d'uscita: finché una sessione resta aperta non se ne può avviare
                un'altra, e un allenamento iniziato per sbaglio bloccherebbe tutto. */}
            <Button
              variant="ghost" size="sm" className="text-muted-foreground"
              onClick={annullaInCorso} disabled={annullamentoInCorso}
            >
              Annulla
            </Button>
          </CardContent>
        </Card>
      )}

      {schede.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nessuna scheda assegnata"
          description="Quando il tuo istruttore te ne assegna una, la trovi qui."
        />
      ) : (
        schede.map((scheda) => (
          <Card key={scheda.id} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="font-heading font-semibold">{scheda.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Assegnata il {formatData(scheda.assigned_date, "media")} ·{" "}
                  {(scheda.routines ?? []).length}{" "}
                  {(scheda.routines ?? []).length === 1 ? "routine" : "routine"}
                </p>
              </div>

              {scheda.notes && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-3">
                  {scheda.notes}
                </p>
              )}

              <div className="space-y-2">
                {(scheda.routines ?? []).map((routine, indice) => {
                  const esercizi = routine.esercizi ?? [];
                  const serie = totaleSerie(esercizi);
                  const chiave = `${scheda.id}__${indice}`;
                  return (
                    <div key={indice} className="rounded-lg border border-border overflow-hidden">
                      <div className="p-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium inline-flex items-center gap-1.5">
                            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                            {routine.nome || `Giorno ${indice + 1}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {esercizi.length} {esercizi.length === 1 ? "esercizio" : "esercizi"} · {serie} serie
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0"
                          disabled={esercizi.length === 0 || avvioInCorso === chiave || Boolean(inCorso)}
                          onClick={() => avvia(scheda, routine, indice)}
                        >
                          <Play className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Avvia
                        </Button>
                      </div>

                      {/* Cosa c'è dentro, prima di avviarla: si controlla al volo se è la
                          giornata giusta, senza doverla far partire per scoprirlo. */}
                      {esercizi.length > 0 && (
                        <Collapsible>
                          <CollapsibleTrigger className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border inline-flex items-center justify-center gap-1 transition-colors">
                            Vedi gli esercizi
                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="border-t border-border divide-y divide-border">
                            {routine.note && (
                              <p className="px-3 py-2 text-xs text-muted-foreground italic">{routine.note}</p>
                            )}
                            {esercizi.map((esercizio, i) => {
                              const rpe = riepilogoRpe(esercizio);
                              const recupero = formatRecupero(esercizio.recupero_secondi);
                              return (
                                <div key={i} className="px-3 py-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-xs font-medium min-w-0">
                                      <span className="text-muted-foreground tabular-nums mr-1">{i + 1}.</span>
                                      {esercizio.exercise_name}
                                    </p>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {riepilogoSerie(esercizio)}
                                      {rpe && ` · ${rpe}`}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    <Badge variant="outline" className="text-[10px] font-normal">
                                      {etichettaGruppo(esercizio.muscle_group)}
                                    </Badge>
                                    {recupero && (
                                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                                        <Timer className="w-3 h-3" aria-hidden="true" /> {recupero}
                                      </span>
                                    )}
                                  </div>
                                  {esercizio.note && (
                                    <p className="text-[10px] text-muted-foreground italic mt-1">{esercizio.note}</p>
                                  )}
                                </div>
                              );
                            })}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {record.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h2 className="text-sm font-heading font-semibold mb-1 inline-flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> I tuoi record
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              La serie migliore per ogni esercizio. Toccane uno per vedere come sta andando.
            </p>
            <ul className="divide-y divide-border">
              {record.map(({ nome, migliore }) => (
                <li key={nome}>
                  <button
                    type="button"
                    onClick={() => setEsercizioAperto(nome)}
                    className="w-full text-left py-2 flex items-center justify-between gap-2 hover:text-primary transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {migliore.peso}kg × {migliore.reps} · {formatData(migliore.data, "media")}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {migliore.massimale} kg stimati
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {concluse.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <h2 className="text-sm font-heading font-semibold mb-3 inline-flex items-center gap-1.5">
              <History className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> Allenamenti fatti
            </h2>
            <ul className="divide-y divide-border">
              {concluse.slice(0, 15).map((sessione) => (
                <li key={sessione.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/member-portal/allenamento/sessione/${sessione.id}`)}
                    className="w-full text-left py-2 flex items-center justify-between gap-2 hover:text-primary transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{sessione.routine_name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {sessione.plan_name} · {formatDataOra(sessione.iniziata_alle)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDurata(
                        (new Date(sessione.terminata_alle) - new Date(sessione.iniziata_alle)) / 1000
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {esercizioAperto && (
        <ProgressiEsercizio
          nomeEsercizio={esercizioAperto}
          righe={righe}
          onChiudi={() => setEsercizioAperto(null)}
        />
      )}

      {dialogoConferma}
    </div>
  );
}
