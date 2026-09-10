import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserCheck, Calendar, AlertTriangle, Clock, FileWarning } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData } from "@/lib/format";

export default function Dashboard() {
  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bookings, setBookings] = useState([]);
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
    ]).then(([m, s, d, b, sess, evts, crs]) => {
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
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <LoadingState minHeight="h-full" />
    );
  }

  const today = moment();

  // Certificate alerts
  const certAlerts = documents
    .filter(d => d.document_type === "Medical Certificate" && d.expiry_date)
    .map(d => {
      const exp = moment(d.expiry_date);
      const member = members.find(m => m.id === d.member_id);
      const daysLeft = exp.diff(today, "days");
      return { ...d, member_name: member?.full_name || "Sconosciuto", daysLeft, expired: daysLeft < 0 };
    })
    .filter(d => d.daysLeft < 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Subscription alerts
  const subAlerts = subscriptions
    .filter(s => s.status === "expiring" || s.status === "expired" || (s.status === "active" && moment(s.end_date).diff(today, "days") <= 14))
    .map(s => {
      const member = members.find(m => m.id === s.member_id);
      const daysLeft = moment(s.end_date).diff(today, "days");
      return { ...s, member_name: member?.full_name || "Sconosciuto", daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Upcoming classes (next 7 days)
  const upcomingBookings = bookings
    .filter(b => b.status !== "cancelled" && b._date && moment(b._date).isSameOrAfter(today, "day") && moment(b._date).isSameOrBefore(moment().add(7, "days"), "day"))
    .sort((a, b) => moment(a._date).diff(moment(b._date)));

  // KPIs
  const activeMembers = subscriptions.filter(s => s.status === "active").length;

  const kpis = [
    { label: "Soci attivi", value: activeMembers, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Soci iscritti", value: members.length, icon: Users, color: "text-info", bg: "bg-info/10" },
    { label: "Certificati in scadenza", value: certAlerts.length, icon: FileWarning, color: "text-warning", bg: "bg-warning/10" },
    { label: "Prossime lezioni", value: upcomingBookings.length, icon: Calendar, color: "text-violet-600", bg: "bg-violet-50" },
  ];

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
                    <StatusBadge status={b.status} />
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