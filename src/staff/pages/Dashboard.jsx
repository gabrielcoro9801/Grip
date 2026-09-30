import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { Users, UserCheck, Calendar, AlertTriangle, Clock, FileWarning } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";

/**
 * La home del gestionale: numeri e avvisi.
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

  const { kpi, certificati, rinnovi, prossime } = dati;
  const kpis = [
    { label: "Soci attivi", value: kpi.soci_attivi, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Soci iscritti", value: kpi.soci_iscritti, icon: Users, color: "text-info", bg: "bg-info/10" },
    { label: "Certificati in scadenza", value: kpi.certificati_in_scadenza, icon: FileWarning, color: "text-warning", bg: "bg-warning/10" },
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

      {/* Alerts Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {certificati && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-warning" />
                Avvisi certificati
                {certificati.length > 0 && (
                  <Badge variant="destructive" className="text-xs ml-auto">{certificati.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {certificati.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Tutti i certificati sono aggiornati</p>
              ) : (
                <div className="space-y-3">
                  {certificati.map(cert => (
                    <div key={cert.id} className={`flex items-center justify-between p-3 rounded-lg ${cert.scaduto ? "bg-destructive/10" : "bg-warning/10"}`}>
                      <div>
                        <p className="text-sm font-medium">{cert.member_name || "Sconosciuto"}</p>
                        <p className="text-xs text-muted-foreground">{cert.file_name}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs ${cert.scaduto ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-warning/10 text-warning border-warning/30"}`}>
                        {cert.scaduto ? `Scaduto da ${Math.abs(cert.giorni)}g` : `${cert.giorni}g residui`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {rinnovi && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                Rinnovi abbonamenti
                {rinnovi.length > 0 && (
                  <Badge variant="destructive" className="text-xs ml-auto">{rinnovi.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rinnovi.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nessun rinnovo imminente</p>
              ) : (
                <div className="space-y-3">
                  {rinnovi.map(sub => (
                    <div key={sub.id} className={`flex items-center justify-between p-3 rounded-lg ${sub.giorni < 0 ? "bg-destructive/10" : "bg-warning/10"}`}>
                      <div>
                        <p className="text-sm font-medium">{sub.member_name || "Sconosciuto"}</p>
                        <p className="text-xs text-muted-foreground">{sub.plan_name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={sub.status} />
                        <span className="text-xs text-muted-foreground">
                          {sub.giorni < 0 ? `da ${Math.abs(sub.giorni)}g` : `${sub.giorni}g`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
