import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, DollarSign, Calendar, AlertTriangle, Clock, FileWarning, TrendingUp } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";

export default function Dashboard() {
  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [revenue, setRevenue] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Member.list(),
      base44.entities.Subscription.list(),
      base44.entities.MemberDocument.list(),
      base44.entities.Booking.list(),
      base44.entities.Revenue.list(),
      base44.entities.Expense.list(),
      base44.entities.Session.list(),
      base44.entities.Event.list(),
      base44.entities.Course.list(),
    ]).then(([m, s, d, b, r, e, sess, evts, crs]) => {
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
      setRevenue(r);
      setExpenses(e);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const today = moment();
  const thirtyDaysOut = moment().add(30, "days");

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
  const totalRevenue = revenue.reduce((sum, r) => sum + (r.amount || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const kpis = [
    { label: "Soci attivi", value: activeMembers, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Ricavi totali", value: `€${totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Spese totali", value: `€${totalExpenses.toLocaleString()}`, icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50" },
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
              <FileWarning className="w-4 h-4 text-amber-500" />
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
                  <div key={cert.id} className={`flex items-center justify-between p-3 rounded-lg ${cert.expired ? "bg-red-50" : "bg-amber-50"}`}>
                    <div>
                      <p className="text-sm font-medium">{cert.member_name}</p>
                      <p className="text-xs text-muted-foreground">{cert.file_name}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${cert.expired ? "bg-red-100 text-red-700 border-red-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
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
              <AlertTriangle className="w-4 h-4 text-amber-500" />
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
                  <div key={sub.id} className={`flex items-center justify-between p-3 rounded-lg ${sub.daysLeft < 0 ? "bg-red-50" : "bg-amber-50"}`}>
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
                      <p className="text-xs text-muted-foreground">{b.member_name} · {b._date ? moment(b._date).format("ddd, MMM D") : "—"}</p>
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