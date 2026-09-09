import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";
import { Link } from "react-router-dom";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData, formatEuro } from "@/lib/format";

export default function SubscriptionsList() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.entities.Subscription.list(),
      api.entities.Member.list(),
    ]).then(([s, m]) => {
      setSubscriptions(s);
      setMembers(m);
      setLoading(false);
    });
  }, []);

  const getMemberName = (id) => members.find(m => m.id === id)?.full_name || "Sconosciuto";

  const filtered = filter === "all" ? subscriptions : subscriptions.filter(s => s.status === filter);

  if (loading) return <LoadingState minHeight="h-64" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Abbonamenti" description={`${subscriptions.length} abbonamenti totali`}>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="active">Attivi</SelectItem>
            <SelectItem value="expiring">In scadenza</SelectItem>
            <SelectItem value="expired">Scaduti</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-3 px-4 font-medium text-muted-foreground">Socio</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Abbonamento</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Periodo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Sessioni</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Prezzo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(sub => (
              <tr key={sub.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4">
                  <Link to={`/crm/members/${sub.member_id}`} className="font-medium text-primary hover:underline">{getMemberName(sub.member_id)}</Link>
                </td>
                <td className="py-3 px-4">{sub.plan_name}</td>
                <td className="py-3 px-4 text-muted-foreground">{formatData(sub.start_date, "giornoBreve")} — {formatData(sub.end_date, "media")}</td>
                <td className="py-3 px-4 text-muted-foreground">{sub.sessions_remaining >= 999 ? "∞" : sub.sessions_remaining}</td>
                <td className="py-3 px-4"><StatusBadge status={sub.status} /></td>
                <td className="py-3 px-4 text-right font-medium">{formatEuro(sub.price_paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}