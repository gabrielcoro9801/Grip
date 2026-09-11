import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Badge } from "@/ui/primitivi/badge";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState, EmptyState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import SelettoreEsercizi from "@/ui/allenamento/SelettoreEsercizi";
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Dumbbell, Timer, Save, Copy, CalendarDays, Link2, Unlink,
} from "lucide-react";
import { etichettaGruppo } from "@/core/domain/gruppiMuscolari";
import {
  nuovaSerie, nuovoEsercizio, nuovaRoutine, clonaRoutines, clonaEsercizi, sposta,
  formatRecupero, totaleSerie, totaleSerieScheda, motivoNonSalvabile,
  TIPI_SERIE, tipoSerie, prossimaLetteraGruppo, togliGruppiOrfani,
} from "@/core/domain/scheda";
import { cn } from "@/ui/utils";

// I recuperi che si scrivono davvero. Il campo resta libero — un PT che vuole 75 secondi
// li scrive — ma il caso normale non deve costare una digitazione.
const RECUPERI_TIPICI = [30, 45, 60, 90, 120, 180];

export default function EditorScheda() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();

  const nuova = id === "nuova";
  const puoModificare = canEdit(staffUser.ruolo, "crm_plans");

  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [soci, setSoci] = useState([]);

  const [scheda, setScheda] = useState(null);
  const [routines, setRoutines] = useState([]);
  const [routineAperta, setRoutineAperta] = useState(0);
  const [modificata, setModificata] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [selettoreAperto, setSelettoreAperto] = useState(false);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const [c, m] = await Promise.all([
        api.entities.Exercise.list("name"),
        api.entities.Member.list("full_name"),
      ]);
      setCatalogo(c);
      setSoci(m);

      if (nuova) {
        // Il tipo arriva dall'elenco da cui si è partiti, e non si cambia più: un modello e
        // la scheda di una persona nascono da due intenzioni diverse, e un interruttore
        // qui inviterebbe solo a sbagliarlo a metà lavoro.
        const daModello = searchParams.get("tipo") === "modello";
        const socioPreselezionato = searchParams.get("member_id");
        const socio = m.find((s) => s.id === socioPreselezionato);
        setScheda({
          is_template: daModello,
          member_id: socio?.id ?? "",
          member_name: socio?.full_name ?? "",
          name: "",
          notes: "",
        });
        // Una scheda nuova nasce con una routine già pronta: creare la scheda e poi
        // doversi ricordare di creare anche il primo giorno è un passaggio a vuoto.
        setRoutines([nuovaRoutine(0)]);
      } else {
        const s = await api.entities.ExercisePlan.get(id);
        setScheda({
          is_template: s.is_template,
          member_id: s.member_id ?? "",
          member_name: s.member_name ?? "",
          name: s.name,
          notes: s.notes ?? "",
          assigned_date: s.assigned_date,
          template_origin_id: s.template_origin_id,
        });
        // Copia profonda: senza, modificare una ripetizione toccherebbe l'oggetto arrivato
        // dall'API, e un annullamento lascerebbe a schermo il valore nuovo.
        setRoutines(clonaRoutines(s.routines));
      }
      setRoutineAperta(0);
      setModificata(false);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, [id, nuova, searchParams]);

  useEffect(() => { carica(); }, [carica]);

  // Chiudere la finestra con del lavoro non salvato è il modo più facile per perdere
  // mezz'ora di scheda. Il browser non lascia personalizzare il messaggio, ma la domanda
  // la fa.
  useEffect(() => {
    if (!modificata) return undefined;
    const avvisa = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avvisa);
    return () => window.removeEventListener("beforeunload", avvisa);
  }, [modificata]);

  const aggiorna = (cambiamento) => {
    setScheda((precedente) => ({ ...precedente, ...cambiamento }));
    setModificata(true);
  };

  // Tutte le modifiche al contenuto passano da qui: `calcola` riceve gli esercizi della
  // routine aperta e restituisce quelli nuovi. Così l'indice della routine viene applicato
  // in un punto solo, invece che in ognuna delle otto funzioni qui sotto.
  const cambiaEserciziRoutineAperta = (calcola) => {
    setRoutines((precedenti) =>
      precedenti.map((r, i) => (i === routineAperta ? { ...r, esercizi: calcola(r.esercizi) } : r))
    );
    setModificata(true);
  };

  const cambiaRoutines = (calcola) => {
    setRoutines((precedenti) => calcola(precedenti));
    setModificata(true);
  };

  const routineCorrente = routines[routineAperta];
  const esercizi = routineCorrente?.esercizi ?? [];

  const aggiungiRoutine = () => {
    cambiaRoutines((precedenti) => [...precedenti, nuovaRoutine(precedenti.length)]);
    setRoutineAperta(routines.length);
  };

  const duplicaRoutine = () => {
    const copia = {
      ...routineCorrente,
      nome: `${routineCorrente.nome} (copia)`,
      esercizi: clonaEsercizi(routineCorrente.esercizi),
    };
    cambiaRoutines((precedenti) => [
      ...precedenti.slice(0, routineAperta + 1),
      copia,
      ...precedenti.slice(routineAperta + 1),
    ]);
    setRoutineAperta(routineAperta + 1);
  };

  const eliminaRoutine = async () => {
    const ok = await conferma({
      title: `Eliminare la routine «${routineCorrente.nome}»?`,
      description: esercizi.length
        ? `Se ne vanno anche i suoi ${esercizi.length} ${esercizi.length === 1 ? "esercizio" : "esercizi"}.`
        : "È vuota.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    cambiaRoutines((precedenti) => precedenti.filter((_, i) => i !== routineAperta));
    setRoutineAperta((corrente) => Math.max(0, corrente - 1));
  };

  const spostaRoutine = (direzione) => {
    const destinazione = routineAperta + direzione;
    if (destinazione < 0 || destinazione >= routines.length) return;
    cambiaRoutines((precedenti) => sposta(precedenti, routineAperta, destinazione));
    setRoutineAperta(destinazione);
  };

  const modificaRoutine = (campo, valore) => {
    cambiaRoutines((precedenti) =>
      precedenti.map((r, i) => (i === routineAperta ? { ...r, [campo]: valore } : r))
    );
  };

  const aggiungiEsercizi = (scelti) => {
    cambiaEserciziRoutineAperta((precedenti) => [...precedenti, ...scelti.map(nuovoEsercizio)]);
  };

  const modificaEsercizio = (indice, campo, valore) => {
    cambiaEserciziRoutineAperta((precedenti) =>
      precedenti.map((es, i) => (i === indice ? { ...es, [campo]: valore } : es))
    );
  };

  const rimuoviEsercizio = (indice) => {
    cambiaEserciziRoutineAperta((precedenti) => precedenti.filter((_, i) => i !== indice));
  };

  /**
   * Aggancia o stacca un esercizio dal superset di quello sopra.
   *
   * Agganciando si eredita la lettera del precedente, o gliene si dà una nuova se non ne
   * ha: un superset nasce sempre da due esercizi, e marcare solo il secondo lascerebbe un
   * gruppo di uno che non significa niente.
   */
  const commutaSuperset = (indice) => {
    cambiaEserciziRoutineAperta((precedenti) => {
      const sopra = precedenti[indice - 1];
      const corrente = precedenti[indice];
      const giaUniti = corrente.gruppo && sopra.gruppo === corrente.gruppo;

      if (giaUniti) {
        // Staccando resta solo l'esercizio sopra col gruppo: se rimane da solo, la lettera
        // non serve più a niente e va tolta anche a lui.
        const restanti = precedenti.map((es, i) => (i === indice ? { ...es, gruppo: null } : es));
        const ancoraInGruppo = restanti.filter((es) => es.gruppo === sopra.gruppo).length;
        return ancoraInGruppo > 1
          ? restanti
          : restanti.map((es) => (es.gruppo === sopra.gruppo ? { ...es, gruppo: null } : es));
      }

      const lettera = sopra.gruppo ?? prossimaLetteraGruppo(precedenti);
      return precedenti.map((es, i) => {
        if (i === indice - 1) return { ...es, gruppo: lettera };
        if (i === indice) return { ...es, gruppo: lettera };
        return es;
      });
    });
  };

  const spostaEsercizio = (indice, direzione) => {
    // Spostando si può spezzare un superset senza dirlo: la lettera resterebbe addosso a
    // due esercizi che non sono più vicini, e ognuno mostrerebbe un «Superset A» da solo —
    // il gruppo di uno che commutaSuperset lavora apposta per non lasciare. Dopo ogni
    // spostamento si ripulisce quello che è rimasto orfano.
    cambiaEserciziRoutineAperta((precedenti) =>
      togliGruppiOrfani(sposta(precedenti, indice, indice + direzione))
    );
  };

  const aggiungiSerie = (indice) => {
    cambiaEserciziRoutineAperta((precedenti) =>
      precedenti.map((es, i) =>
        // La serie nuova ricalca l'ultima: le serie di un esercizio si somigliano quasi
        // sempre, e ribattere 10 e 8 ogni volta è lavoro inutile.
        i === indice ? { ...es, serie: [...es.serie, nuovaSerie(es.serie[es.serie.length - 1])] } : es
      )
    );
  };

  const modificaSerie = (indiceEsercizio, indiceSerie, campo, valore) => {
    cambiaEserciziRoutineAperta((precedenti) =>
      precedenti.map((es, i) =>
        i !== indiceEsercizio
          ? es
          : { ...es, serie: es.serie.map((s, j) => (j === indiceSerie ? { ...s, [campo]: valore } : s)) }
      )
    );
  };

  const rimuoviSerie = (indiceEsercizio, indiceSerie) => {
    cambiaEserciziRoutineAperta((precedenti) =>
      precedenti.map((es, i) =>
        i !== indiceEsercizio ? es : { ...es, serie: es.serie.filter((_, j) => j !== indiceSerie) }
      )
    );
  };

  const motivo = useMemo(
    () => (scheda ? motivoNonSalvabile({
      name: scheda.name,
      isTemplate: scheda.is_template,
      memberId: scheda.member_id,
      routines,
    }) : "Caricamento"),
    [scheda, routines]
  );

  const salva = async () => {
    if (motivo) return;
    setSalvataggio(true);
    try {
      const socio = soci.find((s) => s.id === scheda.member_id);
      const dati = {
        is_template: scheda.is_template,
        // Un modello non è di nessuno: il socio resta vuoto, e il server lo salva come NULL.
        member_id: scheda.is_template ? "" : scheda.member_id,
        member_name: scheda.is_template ? "" : socio?.full_name ?? scheda.member_name,
        name: scheda.name.trim(),
        notes: scheda.notes,
        routines,
      };
      if (nuova) {
        const creata = await api.entities.ExercisePlan.create({
          ...dati,
          assigned_date: scheda.is_template ? null : new Date().toISOString().split("T")[0],
          template_origin_id: null,
        });
        setModificata(false);
        toast({ title: scheda.is_template ? "Modello creato" : `Scheda assegnata a ${socio?.full_name}` });
        // replace: il passo indietro deve riportare all'elenco, non a una pagina "nuova"
        // che ricreerebbe una seconda scheda identica.
        navigate(`/allenamento/schede/${creata.id}`, { replace: true });
      } else {
        await api.entities.ExercisePlan.update(id, dati);
        setModificata(false);
        toast({ title: "Modifiche salvate" });
      }
    } catch (err) {
      toast({ title: "Non è stato possibile salvare", description: err.message, variant: "destructive" });
    }
    setSalvataggio(false);
  };

  const indietro = async () => {
    const destinazione = scheda?.is_template ? "/allenamento/modelli" : "/allenamento/assegnate";
    if (modificata) {
      const ok = await conferma({
        title: "Uscire senza salvare?",
        description: "Le modifiche fatte da quando hai aperto la scheda vanno perse.",
        confirmLabel: "Esci senza salvare",
        destructive: true,
      });
      if (!ok) return;
    }
    navigate(destinazione);
  };

  if (caricamento) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!scheda) return null;

  const serieTotali = totaleSerieScheda(routines);
  const soloLettura = !puoModificare;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={indietro}>
          <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          {scheda.is_template ? "Schede modello" : "Schede assegnate"}
        </Button>
        <div className="flex items-center gap-2">
          {modificata && (
            <span className="text-xs text-muted-foreground" aria-live="polite">Modifiche non salvate</span>
          )}
          {!soloLettura && (
            <Button size="sm" onClick={salva} disabled={Boolean(motivo) || salvataggio || !modificata}>
              <Save className="w-4 h-4 mr-1" aria-hidden="true" />
              {nuova ? "Crea scheda" : "Salva"}
            </Button>
          )}
        </div>
      </div>

      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={scheda.is_template ? "secondary" : "default"} className="font-normal">
              {scheda.is_template ? "Modello di catalogo" : "Scheda di un socio"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {routines.length} {routines.length === 1 ? "routine" : "routine"} · {serieTotali} serie in tutto
            </span>
            {scheda.template_origin_id && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Copy className="w-3 h-3" aria-hidden="true" /> nata da un modello
              </span>
            )}
          </div>

          <div className={scheda.is_template ? "" : "grid sm:grid-cols-2 gap-4"}>
            <div>
              <Label htmlFor="scheda-nome">Nome della scheda *</Label>
              <Input
                id="scheda-nome" disabled={soloLettura}
                value={scheda.name}
                onChange={(e) => aggiorna({ name: e.target.value })}
                placeholder={scheda.is_template ? "Full body principianti" : "Forza — ottobre"}
              />
            </div>
            {!scheda.is_template && (
              <div>
                <Label htmlFor="scheda-socio">Socio *</Label>
                {/* In modifica il socio è bloccato: gli allenamenti già registrati sono
                    suoi, e resterebbero agganciati a una scheda intestata a un altro. Per
                    un'altra persona si assegna una scheda nuova. */}
                <Select
                  value={scheda.member_id}
                  onValueChange={(v) => aggiorna({ member_id: v })}
                  disabled={soloLettura || !nuova}
                >
                  <SelectTrigger id="scheda-socio"><SelectValue placeholder="Scegli il socio" /></SelectTrigger>
                  <SelectContent>
                    {soci.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!nuova && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Una scheda resta di chi l'ha ricevuta: i suoi allenamenti ci sono agganciati.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="scheda-note">Note generali</Label>
            <Textarea
              id="scheda-note" rows={2} disabled={soloLettura}
              value={scheda.notes}
              onChange={(e) => aggiorna({ notes: e.target.value })}
              placeholder="Come impostare la settimana, cosa fare prima di iniziare. Il socio le legge in cima alla scheda."
            />
          </div>
        </CardContent>
      </Card>

      {/* Le routine come schede a linguetta: è la giornata che il socio sceglie di
          avviare, quindi deve essere la divisione più visibile della scheda. */}
      <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
        {routines.map((routine, indice) => (
          <button
            key={indice}
            type="button"
            onClick={() => setRoutineAperta(indice)}
            aria-current={indice === routineAperta ? "true" : undefined}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
              indice === routineAperta
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarDays className="w-4 h-4" aria-hidden="true" />
            {routine.nome || `Giorno ${indice + 1}`}
            <span className="text-xs opacity-70">({routine.esercizi?.length ?? 0})</span>
          </button>
        ))}
        {!soloLettura && (
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={aggiungiRoutine}>
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Routine
          </Button>
        )}
      </div>

      {!routineCorrente ? (
        <EmptyState
          icon={CalendarDays}
          title="La scheda non ha routine"
          description="Una routine è una giornata di allenamento: è quella che il socio sceglie e avvia."
          action={
            !soloLettura ? (
              <Button size="sm" onClick={aggiungiRoutine}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi una routine
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <Card className="border-0 shadow-sm mb-4">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <Label htmlFor="routine-nome">Nome della routine *</Label>
                  <Input
                    id="routine-nome" disabled={soloLettura}
                    value={routineCorrente.nome}
                    onChange={(e) => modificaRoutine("nome", e.target.value)}
                    placeholder="Giorno 1 — Spinta"
                  />
                </div>
                {!soloLettura && (
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9"
                      aria-label="Sposta la routine più a sinistra"
                      disabled={routineAperta === 0}
                      onClick={() => spostaRoutine(-1)}
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9"
                      aria-label="Sposta la routine più a destra"
                      disabled={routineAperta === routines.length - 1}
                      onClick={() => spostaRoutine(1)}
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9"
                      aria-label="Duplica la routine" title="Duplica la routine"
                      onClick={duplicaRoutine}
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                      aria-label="Elimina la routine" title="Elimina la routine"
                      onClick={eliminaRoutine}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="routine-note" className="text-xs">Note della routine</Label>
                <Input
                  id="routine-note" className="h-8 text-sm" disabled={soloLettura}
                  value={routineCorrente.note ?? ""}
                  onChange={(e) => modificaRoutine("note", e.target.value)}
                  placeholder="Es. riscaldamento 10 minuti di bici prima di iniziare"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-heading font-semibold">
              Esercizi di «{routineCorrente.nome || `Giorno ${routineAperta + 1}`}»{" "}
              <span className="text-muted-foreground font-normal">
                ({esercizi.length} · {totaleSerie(esercizi)} serie)
              </span>
            </h2>
            {!soloLettura && esercizi.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setSelettoreAperto(true)}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi esercizi
              </Button>
            )}
          </div>

          {esercizi.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title="La routine è vuota"
              description="Aggiungi il primo esercizio: poi ogni riga che scrivi sotto di esso è una serie."
              action={
                !soloLettura ? (
                  <Button size="sm" onClick={() => setSelettoreAperto(true)}>
                    <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi esercizi
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="space-y-3">
              {esercizi.map((esercizio, indice) => (
                <Card key={indice} className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex items-start gap-2">
                        <span className="text-xs font-semibold text-muted-foreground mt-1 tabular-nums">
                          {indice + 1}.
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{esercizio.exercise_name}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {etichettaGruppo(esercizio.muscle_group)}
                            </Badge>
                            {esercizio.gruppo && (
                              <Badge className="text-[10px] font-normal">
                                <Link2 className="w-2.5 h-2.5 mr-1" aria-hidden="true" />
                                Superset {esercizio.gruppo}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {!soloLettura && (
                        <div className="flex items-center gap-0.5 shrink-0 -mt-1 -mr-2">
                          {/* Il superset si costruisce agganciando un esercizio a quello
                              sopra: è così che si legge su un foglio (A1, A2), e non
                              serve nessuna finestra per dirlo. */}
                          {indice > 0 && (
                            <Button
                              variant="ghost" size="icon" className="h-9 w-9"
                              aria-label={
                                esercizio.gruppo && esercizi[indice - 1].gruppo === esercizio.gruppo
                                  ? `Stacca ${esercizio.exercise_name} dal superset`
                                  : `Unisci ${esercizio.exercise_name} all'esercizio sopra, in superset`
                              }
                              title={
                                esercizio.gruppo && esercizi[indice - 1].gruppo === esercizio.gruppo
                                  ? "Stacca dal superset"
                                  : "Unisci in superset"
                              }
                              onClick={() => commutaSuperset(indice)}
                            >
                              {esercizio.gruppo && esercizi[indice - 1].gruppo === esercizio.gruppo
                                ? <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                                : <Link2 className="w-3.5 h-3.5" aria-hidden="true" />}
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon" className="h-9 w-9"
                            aria-label={`Sposta ${esercizio.exercise_name} più in alto`}
                            disabled={indice === 0}
                            onClick={() => spostaEsercizio(indice, -1)}
                          >
                            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-9 w-9"
                            aria-label={`Sposta ${esercizio.exercise_name} più in basso`}
                            disabled={indice === esercizi.length - 1}
                            onClick={() => spostaEsercizio(indice, 1)}
                          >
                            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                            aria-label={`Togli ${esercizio.exercise_name} dalla routine`}
                            onClick={() => rimuoviEsercizio(indice)}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Le serie: una riga per serie, come sono scritte su un foglio. */}
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <caption className="sr-only">Serie di {esercizio.exercise_name}</caption>
                        <thead>
                          <tr className="bg-muted/50 text-xs text-muted-foreground">
                            <th scope="col" className="text-left font-medium py-1.5 px-2 w-16">Serie</th>
                            <th scope="col" className="text-left font-medium py-1.5 px-2">Ripetizioni</th>
                            <th scope="col" className="text-left font-medium py-1.5 px-2 w-28">RPE</th>
                            {!soloLettura && <th scope="col" className="w-10"><span className="sr-only">Azioni</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {esercizio.serie.map((serie, indiceSerie) => (
                            <tr key={indiceSerie} className="border-t border-border">
                              <td className="py-1.5 px-2">
                                {/* Il numero della serie è anche il selettore del tipo:
                                    è il posto dove si guarda già, e non ruba una colonna
                                    a ripetizioni e RPE, che sono quelle che si scrivono. */}
                                <Select
                                  value={serie.tipo ?? "normale"}
                                  onValueChange={(v) => modificaSerie(indice, indiceSerie, "tipo", v)}
                                  disabled={soloLettura}
                                >
                                  <SelectTrigger
                                    className="h-8 w-14 text-xs px-2"
                                    aria-label={`Tipo della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                                  >
                                    <span className="tabular-nums">
                                      {tipoSerie(serie.tipo).sigla || indiceSerie + 1}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(TIPI_SERIE).map(([codice, t]) => (
                                      <SelectItem key={codice} value={codice}>
                                        {t.sigla ? `${t.sigla} — ` : ""}{t.etichetta}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  className="h-8 text-sm" disabled={soloLettura}
                                  value={serie.reps ?? ""}
                                  onChange={(e) => modificaSerie(indice, indiceSerie, "reps", e.target.value)}
                                  // Testo e non numero: "8-10", "max", "30 sec" per un plank
                                  // sono tutte cose che un PT scrive, e un campo numerico le
                                  // rifiuterebbe.
                                  placeholder="10, 8-12, max…"
                                  aria-label={`Ripetizioni della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  type="number" min="1" max="10" step="0.5"
                                  className="h-8 text-sm" disabled={soloLettura}
                                  value={serie.rpe ?? ""}
                                  onChange={(e) =>
                                    modificaSerie(indice, indiceSerie, "rpe", e.target.value === "" ? null : Number(e.target.value))
                                  }
                                  placeholder="1-10"
                                  aria-label={`RPE della serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                                />
                              </td>
                              {!soloLettura && (
                                <td className="py-1.5 pr-2">
                                  <Button
                                    variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                                    aria-label={`Elimina la serie ${indiceSerie + 1} di ${esercizio.exercise_name}`}
                                    // L'ultima serie non si toglie: un esercizio senza serie non
                                    // è un esercizio, e la scheda non si salverebbe. Per toglierlo
                                    // del tutto c'è il cestino dell'esercizio.
                                    disabled={esercizio.serie.length === 1}
                                    onClick={() => rimuoviSerie(indice, indiceSerie)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!soloLettura && (
                        <div className="border-t border-border">
                          <Button
                            variant="ghost" size="sm"
                            className="w-full h-8 rounded-none text-xs text-muted-foreground"
                            onClick={() => aggiungiSerie(indice)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Aggiungi serie
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={`recupero-${indice}`} className="text-xs flex items-center gap-1">
                          <Timer className="w-3 h-3" aria-hidden="true" /> Recupero fra le serie
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`recupero-${indice}`} type="number" min="0" step="15"
                            className="h-8 text-sm w-24" disabled={soloLettura}
                            value={esercizio.recupero_secondi ?? ""}
                            onChange={(e) =>
                              modificaEsercizio(indice, "recupero_secondi", e.target.value === "" ? null : Number(e.target.value))
                            }
                            placeholder="sec"
                          />
                          <span className="text-xs text-muted-foreground w-14">
                            {formatRecupero(esercizio.recupero_secondi)}
                          </span>
                          {!soloLettura && (
                            <div className="flex flex-wrap gap-1">
                              {RECUPERI_TIPICI.map((secondi) => (
                                <button
                                  key={secondi}
                                  type="button"
                                  onClick={() => modificaEsercizio(indice, "recupero_secondi", secondi)}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {formatRecupero(secondi)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`note-${indice}`} className="text-xs">Note sull'esercizio</Label>
                        <Input
                          id={`note-${indice}`}
                          className="h-8 text-sm" disabled={soloLettura}
                          value={esercizio.note ?? ""}
                          onChange={(e) => modificaEsercizio(indice, "note", e.target.value)}
                          placeholder="Es. tenuta di 2 secondi in basso"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {!soloLettura && (
                <Button variant="outline" className="w-full" onClick={() => setSelettoreAperto(true)}>
                  <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Aggiungi esercizi
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* Il motivo per cui il salvataggio è spento, scritto accanto al pulsante spento:
          un pulsante disabilitato senza spiegazione è il modo più rapido per bloccare
          qualcuno su una schermata. */}
      {!soloLettura && motivo && (
        <p className="text-xs text-muted-foreground mt-4 text-right" aria-live="polite">
          Per salvare: {motivo}
        </p>
      )}

      <SelettoreEsercizi
        aperto={selettoreAperto}
        onChiudi={() => setSelettoreAperto(false)}
        esercizi={catalogo}
        onAggiungi={aggiungiEsercizi}
      />

      {dialogoConferma}
    </>
  );
}
