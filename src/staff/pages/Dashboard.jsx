import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Badge } from "@/ui/primitivi/badge";
import { Users, UserCheck, Calendar, AlertTriangle, Clock, FileWarning, UserPlus, PhoneCall } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canAccess } from "@/staff/lib/permissions";
import { formatData, giorniAllaData, giorniTra, aggiungiGiorni, stessoGiornoOdopo, toIsoDate } from "@/core/domain/format";
import { leadPrevistiAiCorsi, leadDaRicontattare, proveDaEsitare } from "@/core/domain/lead";

// La finestra dei lead previsti è la stessa delle prossime lezioni: una settimana.
const GIORNI_PREVISTI = 7;

export default function Dashboard() {
  const { staffUser } = useStaffAuth();
  // Chi non lavora sui lead non ha ragione di vederli qui, né di scaricarli.
  const vedeLead = canAccess(staffUser?.ruolo, "crm_leads");

  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [corsi, setCorsi] = useState({ bookings: [], sessions: [], events: [], courses: [] });
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.entities.Member.list(),
      api.entities.Subscription.list(),
      api.entities.MemberDocument.list(),
      api.entities.Booking.list(),
      api.entities.Session.list(),
      api.entities.Event.list(),
      api.entities.Course.list(),
      vedeLead ? api.entities.Lead.list() : Promise.resolve([]),
    ]).then(([m, s, d, b, sess, evts, crs, l]) => {
      const resolvedBookings = b.map(bk => {
        const session = sess.find(s => s.id === bk.session_id);
        const event = evts.find(e => e.id === session?.event_id);
        const course = crs.find(c => c.id === event?.course_id);
        return { ...bk, _course_name: course?.name, _date: session?.date };
      });
      setMembers(m);
      setSubscriptions(s);
      setDocuments(d);
      setBookings(resolvedBookings);
      setCorsi({ bookings: b, sessions: sess, events: evts, courses: crs });
      setLeads(l);
      setLoading(false);
    });
  }, [vedeLead]);

  if (loading) {
    return (
      <LoadingState minHeight="h-full" />
    );
  }

  // Certificate alerts
  const certAlerts = documents
    .filter(d => d.document_type === "Medical Certificate" && d.expiry_date)
    .map(d => {
      const member = members.find(m => m.id === d.member_id);
      const daysLeft = giorniAllaData(d.expiry_date);
      return { ...d, member_name: member?.full_name || "Sconosciuto", daysLeft, expired: daysLeft < 0 };
    })
    .filter(d => d.daysLeft < 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Subscription alerts
  const subAlerts = subscriptions
    // `giorniAllaData` risponde `null` quando la scadenza non c'è, e `null <= 14` in
    // JavaScript è **vero**: senza questo controllo, un abbonamento senza data di fine
    // comparirebbe fra quelli in scadenza. Con moment usciva NaN, che invece è falso —
    // ed è il genere di differenza che una sostituzione si porta dietro in silenzio.
    .filter(s => {
      if (s.status === "expiring" || s.status === "expired") return true;
      const giorni = giorniAllaData(s.end_date);
      return s.status === "active" && giorni !== null && giorni <= 14;
    })
    .map(s => {
      const member = members.find(m => m.id === s.member_id);
      const daysLeft = giorniAllaData(s.end_date);
      return { ...s, member_name: member?.full_name || "Sconosciuto", daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Upcoming classes (next 7 days)
  const fraUnaSettimana = aggiungiGiorni(new Date(), 7);
  const upcomingBookings = bookings
    .filter(b =>
      b.status !== "cancelled" && b._date
      && stessoGiornoOdopo(b._date)
      && stessoGiornoOdopo(fraUnaSettimana, b._date))
    .sort((a, b) => giorniTra(a._date, b._date));

  // KPIs
  const activeMembers = subscriptions.filter(s => s.status === "active").length;

  // Lead ai corsi
  const oggi = toIsoDate(new Date());
  const previsti = vedeLead ? leadPrevistiAiCorsi({ ...corsi, leads }, oggi, GIORNI_PREVISTI) : [];
  const provePreviste = previsti.reduce((n, g) => n + g.prove.length, 0);
  const daEsitare = vedeLead ? proveDaEsitare(corsi, oggi) : [];
  const daRicontattare = vedeLead ? leadDaRicontattare(leads, oggi) : [];

  const kpis = [
    { label: "Soci attivi", value: activeMembers, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Soci iscritti", value: members.length, icon: Users, color: "text-info", bg: "bg-info/10" },
    { label: "Certificati in scadenza", value: certAlerts.length, icon: FileWarning, color: "text-warning", bg: "bg-warning/10" },
    { label: "Prossime lezioni", value: upcomingBookings.length, icon: Calendar, color: "text-violet-600", bg: "bg-violet-50" },
    ...(vedeLead ? [
      { label: `Prove in programma (${GIORNI_PREVISTI}g)`, value: provePreviste, icon: UserPlus, color: "text-info", bg: "bg-info/10" },
      { label: "Lead da ricontattare", value: daRicontattare.length, icon: PhoneCall, color: "text-warning", bg: "bg-warning/10" },
    ] : []),
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Panoramica e avvisi a colpo d'occhio</p>
      </div>

      {/* KPI Cards */}
      <div className={`grid grid-cols-2 gap-4 ${kpis.length > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-4"}`}>
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
        {/* Certificate Alerts */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-warning" />
              Avvisi certificati
              {certAlerts.length > 0 && (
                <Badge variant="destructive" className="text-xs ml-auto">{certAlerts.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {certAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Tutti i certificati sono aggiornati</p>
            ) : (
              <div className="space-y-3">
                {certAlerts.map(cert => (
                  <div key={cert.id} className={`flex items-center justify-between p-3 rounded-lg ${cert.expired ? "bg-destructive/10" : "bg-warning/10"}`}>
                    <div>
                      <p className="text-sm font-medium">{cert.member_name}</p>
                      <p className="text-xs text-muted-foreground">{cert.file_name}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${cert.expired ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-warning/10 text-warning border-warning/30"}`}>
                      {cert.expired ? `Scaduto da ${Math.abs(cert.daysLeft)}g` : `${cert.daysLeft}g residui`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscription Alerts */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Rinnovi abbonamenti
              {subAlerts.length > 0 && (
                <Badge variant="destructive" className="text-xs ml-auto">{subAlerts.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessun rinnovo imminente</p>
            ) : (
              <div className="space-y-3">
                {subAlerts.map(sub => (
                  <div key={sub.id} className={`flex items-center justify-between p-3 rounded-lg ${sub.daysLeft < 0 ? "bg-destructive/10" : "bg-warning/10"}`}>
                    <div>
                      <p className="text-sm font-medium">{sub.member_name}</p>
                      <p className="text-xs text-muted-foreground">{sub.plan_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={sub.status} />
                      <span className="text-xs text-muted-foreground">
                        {sub.daysLeft < 0 ? `da ${Math.abs(sub.daysLeft)}g` : `${sub.daysLeft}g`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead previsti ai corsi */}
        {vedeLead && (
          <Card className="border-0 shadow-sm lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-info" />
                Lead previsti ai corsi ({GIORNI_PREVISTI} giorni)
                <Link to="/crm/lead" className="ml-auto text-xs font-normal text-primary hover:underline">Tutti i lead</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {daEsitare.length > 0 && (
                // Prima delle prove di domani: una prova passata senza esito lascia il lead
                // fermo in "prova prenotata", e nessuno lo richiama.
                <div className="p-3 rounded-lg bg-warning/10 text-sm">
                  <p className="font-medium">
                    {daEsitare.length === 1 ? "Una prova passata" : `${daEsitare.length} prove passate`} senza esito
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Segna se la persona è venuta:{" "}
                    {daEsitare.slice(0, 5).map((b, i) => (
                      <React.Fragment key={b.id}>
                        {i > 0 && ", "}
                        <Link to={`/crm/lead/${b.lead_id}`} className="text-primary hover:underline">{b.member_name}</Link>
                      </React.Fragment>
                    ))}
                    {daEsitare.length > 5 && ` e altre ${daEsitare.length - 5}`}
                  </p>
                </div>
              )}
              {previsti.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nessuna prova in programma</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {previsti.map(gruppo => (
                    <div key={gruppo.corso.id ?? "senza-corso"} className="space-y-2">
                      <p className="text-sm font-medium flex items-center justify-between">
                        {gruppo.corso.nome}
                        <span className="text-xs font-normal text-muted-foreground">
                          {gruppo.prove.length} {gruppo.prove.length === 1 ? "prova" : "prove"}
                        </span>
                      </p>
                      {gruppo.prove.map(p => (
                        <Link
                          key={p.booking_id}
                          to={`/crm/lead/${p.lead_id}`}
                          className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{p.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.data === oggi ? "Oggi" : formatData(p.data, "giorno")} {p.inizio ? String(p.inizio).slice(0, 5) : ""}
                            </p>
                          </div>
                          {p.stato_prenotazione === "waitlisted"
                            ? <StatusBadge status="waitlisted" />
                            : p.stato_lead && <StatusBadge status={p.stato_lead} />}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upcoming Classes */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Prossime lezioni prenotate (7 giorni)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nessuna prenotazione imminente</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {upcomingBookings.map(b => (
                  <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{b._course_name || "Corso"}</p>
                      <p className="text-xs text-muted-foreground">{b.member_name} · {b._date ? formatData(b._date, "giorno") : "—"}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {b.lead_id && <StatusBadge status="prova" label="Prova" tone="info" />}
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}