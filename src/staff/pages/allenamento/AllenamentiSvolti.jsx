import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import DettaglioAllenamento from "@/staff/components/DettaglioAllenamento";
import { History, AlertCircle, Play } from "lucide-react";
import { formatData, formatDataOra } from "@/core/domain/format";
import { formatDurata, statisticheAllenamento, durataSessione } from "@/core/domain/scheda";

// Da quanti giorni senza allenarsi un socio va segnalato. Sette giorni è la settimana: chi
// si allena tre volte a settimana e salta sette giorni ha saltato un ciclo intero, e non è
// più una dimenticanza.
const GIORNI_DI_SILENZIO = 7;

// Un array e non un oggetto: le chiavi numeriche di un oggetto vengono elencate in ordine
// crescente, quindi "0 — Sempre" finirebbe in cima al menu invece che in fondo.
const PERIODI = [
  { giorni: "7", etichetta: "Ultimi 7 giorni" },
  { giorni: "30", etichetta: "Ultimi 30 giorni" },
  { giorni: "90", etichetta: "Ultimi 3 mesi" },
  { giorni: "0", etichetta: "Sempre" },
];

export default function AllenamentiSvolti() {
  const [sessioni, setSessioni] = useState([]);
  const [righe, setRighe] = useState([]);
  const [schede, setSchede] = useState([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(null);

  const [filtroSocio, setFiltroSocio] = useState("tutti");
  const [periodo, setPeriodo] = useState("30");
  const [aperta, setAperta] = useState(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const [ses, log, sch] = await Promise.all([
        api.entities.WorkoutSession.list("-iniziata_alle", 500),
        api.entities.WorkoutLog.list("-data", 2000),
        api.entities.ExercisePlan.filter({ is_template: false }),
      ]);
      setSessioni(ses);
      setRighe(log);
      setSchede(sch);
    } catch (err) {
      setErrore(err);
    }
    setCaricamento(false);
  }, []);

  useEffect(() => { carica(); }, [carica]);

  // Le sessioni si portano dietro il nome della scheda ma non quello del socio: lo si
  // recupera dalla scheda, che ce l'ha copiato accanto.
  const nomiSoci = useMemo(() => {
    const per = new Map();
    for (const scheda of schede) {
      if (scheda.member_id && scheda.member_name) per.set(scheda.member_id, scheda.member_name);
    }
    return per;
  }, [schede]);

  const righePerSessione = useMemo(() => {
    const per = new Map();
    for (const riga of righe) {
      if (!riga.session_id) continue;
      if (!per.has(riga.session_id)) per.set(riga.session_id, []);
      per.get(riga.session_id).push(riga);
    }
    return per;
  }, [righe]);

  const sociConScheda = useMemo(() => {
    const per = new Map();
    for (const scheda of schede) {
      if (scheda.member_id) per.set(scheda.member_id, scheda.member_name || "Socio");
    }
    return [...per.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [schede]);

  const visibili = useMemo(() => {
    const giorni = Number(periodo);
    const soglia = giorni ? Date.now() - giorni * 86400000 : 0;
    return sessioni.filter((s) => {
      if (filtroSocio !== "tutti" && s.member_id !== filtroSocio) return false;
      if (soglia && new Date(s.iniziata_alle).getTime() < soglia) return false;
      return true;
    });
  }, [sessioni, filtroSocio, periodo]);

  // Chi ha una scheda e non si allena. È la domanda che un istruttore si fa davvero
  // guardando questa pagina, e senza una riga apposta si risponde solo scorrendo l'elenco
  // e accorgendosi di chi *non* c'è — cioè non rispondendo affatto.
  const fermi = useMemo(() => {
    const ultimaPerSocio = new Map();
    for (const sessione of sessioni) {
      const corrente = ultimaPerSocio.get(sessione.member_id);
      const quando = new Date(sessione.iniziata_alle).getTime();
      if (!corrente || quando > corrente) ultimaPerSocio.set(sessione.member_id, quando);
    }
    const soglia = Date.now() - GIORNI_DI_SILENZIO * 86400000;
    return sociConScheda
      .map((socio) => ({ ...socio, ultima: ultimaPerSocio.get(socio.id) ?? null }))
      .filter((socio) => socio.ultima === null || socio.ultima < soglia)
      .sort((a, b) => (a.ultima ?? 0) - (b.ultima ?? 0));
  }, [sociConScheda, sessioni]);

  const routineDi = (sessione) => {
    const scheda = schede.find((s) => s.id === sessione.plan_id);
    return (scheda?.routines ?? [])[sessione.routine_index] ?? null;
  };

  if (caricamento) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <>
      <PageHeader
        title="Allenamenti svolti"
        description="Cosa hanno fatto davvero i soci con le schede che gli hai assegnato."
      />

      {fermi.length > 0 && (
        <Card className="border-0 shadow-sm mb-6 bg-warning/5 ring-1 ring-warning/20">
          <CardContent className="p-4">
            <h2 className="text-sm font-heading font-semibold inline-flex items-center gap-1.5 mb-2">
              <AlertCircle className="w-4 h-4 text-warning" aria-hidden="true" />
              Da {GIORNI_DI_SILENZIO} giorni non si allenano
            </h2>
            <ul className="flex flex-wrap gap-2">
              {fermi.map((socio) => (
                <li key={socio.id}>
                  <Link
                    to={`/crm/soci/${socio.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border text-xs hover:border-primary transition-colors"
                  >
                    {socio.nome}
                    <span className="text-muted-foreground">
                      {socio.ultima ? formatData(new Date(socio.ultima).toISOString(), "media") : "mai"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <Select value={filtroSocio} onValueChange={setFiltroSocio}>
          <SelectTrigger className="sm:w-64" aria-label="Filtra per socio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti i soci</SelectItem>
            {sociConScheda.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="sm:w-48" aria-label="Filtra per periodo"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODI.map(({ giorni, etichetta }) => (
              <SelectItem key={giorni} value={giorni}>{etichetta}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={History}
          title={sessioni.length === 0 ? "Nessun allenamento registrato" : "Nessun allenamento nel periodo"}
          description={
            sessioni.length === 0
              ? "Quando un socio avvia una routine dal portale, l'allenamento compare qui con i carichi che ha usato."
              : "Prova ad allargare il periodo o a togliere il filtro sul socio."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visibili.map((sessione) => {
            const sue = righePerSessione.get(sessione.id) ?? [];
            const { serie, volume } = statisticheAllenamento(sue);
            const inCorso = !sessione.terminata_alle;
            return (
              <li key={sessione.id}>
                <button
                  type="button"
                  onClick={() => setAperta(sessione)}
                  className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-primary transition-colors flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {nomiSoci.get(sessione.member_id) ?? "Socio"}
                      <span className="text-muted-foreground font-normal"> · {sessione.routine_name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {sessione.plan_name} · {formatDataOra(sessione.iniziata_alle)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-xs text-muted-foreground tabular-nums">
                    {inCorso ? (
                      <Badge variant="outline" className="text-[10px] font-normal border-primary text-primary">
                        <Play className="w-2.5 h-2.5 mr-1" aria-hidden="true" /> in corso
                      </Badge>
                    ) : (
                      <>
                        <span className="block">{formatDurata(durataSessione(sessione))}</span>
                        <span className="block">
                          {serie} serie · {Math.round(volume).toLocaleString("it-IT")} kg
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {aperta && (
        <DettaglioAllenamento
          sessione={{ ...aperta, member_name: nomiSoci.get(aperta.member_id) }}
          righe={righePerSessione.get(aperta.id) ?? []}
          routine={routineDi(aperta)}
          onChiudi={() => setAperta(null)}
        />
      )}
    </>
  );
}
