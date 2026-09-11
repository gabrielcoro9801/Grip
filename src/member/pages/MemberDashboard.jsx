import React, { useState, useEffect } from "react";
import { caricaProfilo } from "@/core/api/portale";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { CreditCard, QrCode, FileText, User, ChevronRight, Calendar, AlertCircle } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { formatData } from "@/core/domain/format";

export default function MemberDashboard() {
  const { memberUser } = useMemberAuth();
  const [profilo, setProfilo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Una richiesta sola: anagrafica e abbonamento arrivano insieme, e quale sia
  // l'abbonamento in corso lo ha già deciso il server.
  useEffect(() => {
    caricaProfilo()
      .then(setProfilo)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  const member = profilo?.socio;
  const activeSub = profilo?.abbonamento;
  const daysToExpiry = activeSub?.giorni_alla_scadenza ?? null;
  const expiringSoon = Boolean(activeSub?.in_scadenza) && daysToExpiry >= 0;

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
          Ciao, {member?.nome?.split(" ")[0] || memberUser.nome}
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
                <h3 className="font-medium">{activeSub.piano}</h3>
                <StatusBadge status={activeSub.stato} />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Inizio: {formatData(activeSub.inizio, "media")}</div>
                <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Fine: {formatData(activeSub.fine, "media")}</div>
              </div>
              {expiringSoon && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
                  <AlertCircle className="w-4 h-4" />
                  In scadenza tra {daysToExpiry} giorni
                </div>
              )}
              {activeSub.ingressi_residui != null && (
                <p className="text-xs text-muted-foreground">Ingressi residui: {activeSub.ingressi_residui}</p>
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