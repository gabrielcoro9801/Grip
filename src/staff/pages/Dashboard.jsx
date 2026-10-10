import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Link } from "react-router-dom";
import { Users, UserCheck, Calendar, Clock, FileWarning, UserX, ListChecks, ChevronRight } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";
import { etichettaMotivoAbbandono } from "@/core/domain/lead";
import { LINEE } from "@/core/domain/segnali";

/**
 * La home del gestionale: i numeri, e quante persone aspettano in ogni linea di Da fare.
 *
 * Il lavoro non si fa qui: le liste dei rinnovi e dei certificati erano doppioni di Da fare, e
 * sono diventate tessere con il conteggio che portano alla linea. La dashboard è il quadro.
 *
 * Li conta il server (`GET /api/dashboard`). Prima questa pagina scaricava sette tabelle
 * intere — tutte le prenotazioni e tutte le lezioni comprese — e le incrociava qui. Le regole
 * non sono cambiate: un certificato già sostituito non è un avviso, di un abbonamento scaduto
 * si avvisa solo chi non ha rinnovato, "soci attivi" conta soci e non abbonamenti.
 *
 * Una parte che il ruolo non può vedere arriva `null` e non si mostra.
 */
export default function Dashboard() {
  const [dati, setDati] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  // Senza la gestione dell'errore, alla prima richiesta fallita la pagina restava sulla
  // rotellina per sempre: nessun messaggio, nessun modo di riprovare se non ricaricare tutto.
  const carica = useCallback(() => {
    setLoading(true);
    setErrore(null);
    api.dashboard().then(setDati).catch(setErrore).finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  if (loading) return <LoadingState minHeight="h-full" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} className="h-full" />;

  const { kpi, da_fare: daFare, prossime, abbandoni } = dati;
  const kpis = [
    { label: "Soci attivi", value: kpi.soci_attivi, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Soci iscritti", value: kpi.soci_iscritti, icon: Users, color: "text-info", bg: "bg-info/10" },
    { label: "Documenti da sistemare", value: kpi.documenti_da_sistemare, icon: FileWarning, color: "text-warning", bg: "bg-warning/10" },
    { label: "Prossime lezioni", value: kpi.prossime_lezioni, icon: Calendar, color: "text-violet-600", bg: "bg-violet-50" },
  ].filter((k) => k.value !== null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Panoramica e avvisi a colpo d'occhio</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={`${kpi.bg} p-2 rounded-lg`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Da fare: una tessera per linea, con quante persone aspettano. Il clic porta alla linea. */}
      {daFare && (
        <section aria-labelledby="dashboard-da-fare">
          <h2 id="dashboard-da-fare" className="text-base font-heading font-semibold flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-primary" aria-hidden="true" /> Da fare
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {LINEE.filter((l) => l.valore in daFare).map((l) => (
              <Link key={l.valore} to={`/da-fare?linea=${l.valore}`}
                className="group rounded-lg bg-card shadow-sm p-3 hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-1">
                  {l.etichetta} <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                </p>
                <p className={`text-2xl font-bold tabular-nums mt-1 ${daFare[l.valore] ? "" : "text-muted-foreground/60"}`}>{daFare[l.valore]}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Perché se ne vanno: i motivi scelti archiviando, negli ultimi 12 mesi. */}
        {abbandoni && abbandoni.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <UserX className="w-4 h-4 text-muted-foreground" />
                Perché se ne vanno
                <span className="text-xs font-normal text-muted-foreground ml-auto">ultimi 12 mesi</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {abbandoni.map((a) => (
                  <li key={a.motivo} className="text-sm">
                    <div className="flex justify-between gap-2"><span>{etichettaMotivoAbbandono(a.motivo)}</span><span className="tabular-nums font-medium">{a.quanti}</span></div>
                    <div className="h-1.5 rounded-full bg-muted mt-1" aria-hidden="true">
                      <div className="h-1.5 rounded-full bg-primary/60" style={{ width: `${(a.quanti / abbandoni[0].quanti) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {prossime && (
          <Card className="border-0 shadow-sm lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Prossime lezioni prenotate (7 giorni)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {prossime.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nessuna prenotazione imminente</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {prossime.map(b => (
                    <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-sm font-medium">{b.course_name || "Corso"}</p>
                        <p className="text-xs text-muted-foreground">{b.member_name} · {formatData(b.date, "giorno")}</p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
