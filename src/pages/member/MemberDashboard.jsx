import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, QrCode, FileText, User, ChevronRight, Calendar, AlertCircle } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData } from "@/lib/format";

export default function MemberDashboard() {
  const { memberUser } = useMemberAuth();
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    (async () => {
      const [m, subs] = await Promise.all([
        api.entities.Member.get(memberUser.member_id),
        api.entities.Subscription.filter({ member_id: memberUser.member_id }),
      ]);
      setMember(m);
      setSubscriptions(subs);
      setLoading(false);
    })();
  }, [memberUser?.member_id]);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  const activeSub = subscriptions.find(s => s.status === "active") || subscriptions[0];
  const daysToExpiry = activeSub ? moment(activeSub.end_date).diff(moment(), "days") : null;
  const expiringSoon = daysToExpiry !== null && daysToExpiry <= 7 && daysToExpiry >= 0;

  const quickLinks = [
    { label: "Documenti", path: "/member-portal/documenti", icon: FileText, desc: "I tuoi documenti" },
    { label: "Abbonamento", path: "/member-portal/abbonamento", icon: CreditCard, desc: "Stato e dettagli" },
    { label: "Anagrafica", path: "/member-portal/anagrafica", icon: User, desc: "I tuoi dati" },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-heading font-bold">
          Ciao, {member?.full_name?.split(" ")[0] || memberUser.nome}
        </h1>
        <p className="text-sm text-muted-foreground">Benvenuto nella tua area personale</p>
      </div>

      {/* Subscription summary */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Il mio abbonamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeSub ? (
            <p className="text-sm text-muted-foreground text-center py-3">Nessun abbonamento attivo</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{activeSub.plan_name}</h3>
                <StatusBadge status={activeSub.status} />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Inizio: {formatData(activeSub.start_date, "media")}</div>
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Fine: {formatData(activeSub.end_date, "media")}</div>
              </div>
              {expiringSoon && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                  <AlertCircle className="w-4 h-4" />
                  In scadenza tra {daysToExpiry} giorni
                </div>
              )}
              {activeSub.sessions_remaining != null && (
                <p className="text-xs text-muted-foreground">Ingressi residui: {activeSub.sessions_remaining}</p>
              )}
              <Link to="/member-portal/abbonamento">
                <Button variant="ghost" size="sm" className="w-full mt-1">
                  Dettagli <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR quick access */}
      <Link to="/member-portal/qr">
        <Card className="border-0 shadow-sm bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <QrCode className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">QR Accesso</h3>
              <p className="text-xs text-muted-foreground">Tocca per mostrare il codice di ingresso</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      {/* Quick links grid */}
      <div className="grid grid-cols-2 gap-3">
        {quickLinks.map(link => (
          <Link key={link.path} to={link.path}>
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
              <CardContent className="p-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-2">
                  <link.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-medium text-sm">{link.label}</h3>
                <p className="text-xs text-muted-foreground">{link.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}