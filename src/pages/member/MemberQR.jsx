import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle } from "lucide-react";
import { generateQRCode, getQRImageUrl } from "@/lib/qrUtils";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";

export default function MemberQR() {
  const { memberUser } = useMemberAuth();
  const [qr, setQr] = useState(null);
  const [member, setMember] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    (async () => {
      const [m, subs, qrs] = await Promise.all([
        api.entities.Member.get(memberUser.member_id),
        api.entities.Subscription.filter({ member_id: memberUser.member_id }),
        api.entities.QRAccesso.filter({ cliente_id: memberUser.member_id }),
      ]);
      setMember(m);
      setSubscriptions(subs);

      // Auto-generate QR if none exists (static, generated once)
      if (qrs.length === 0) {
        const newQr = await api.entities.QRAccesso.create({
          cliente_id: memberUser.member_id,
          cliente_name: m?.full_name || memberUser.nome,
          codice: generateQRCode(),
          data_generazione: new Date().toISOString(),
          stato: "attivo",
        });
        setQr(newQr);
      } else {
        setQr(qrs[0]);
      }
      setLoading(false);
    })();
  }, [memberUser?.member_id]);

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  const activeSub = subscriptions.find(s => s.status === "active");
  const daysToExpiry = activeSub ? moment(activeSub.end_date).diff(moment(), "days") : null;
  const isRevoked = qr?.stato === "revocato";
  const canAccess = activeSub && daysToExpiry >= 0 && !isRevoked;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-heading font-bold">QR Accesso</h1>
        <p className="text-sm text-muted-foreground">{member?.full_name || memberUser.nome}</p>
      </div>

      {/* QR Code */}
      <Card className="border-0 shadow-lg w-full max-w-xs">
        <CardContent className="p-6 flex flex-col items-center gap-4">
          {isRevoked ? (
            <div className="w-56 h-56 rounded-xl bg-muted/30 flex flex-col items-center justify-center gap-3">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <p className="text-sm text-destructive font-medium text-center px-4">
                QR revocato. Rivolgiti alla reception.
              </p>
            </div>
          ) : (
            <div className="relative">
              <img
                src={getQRImageUrl(qr?.codice || "", 300)}
                alt="QR Accesso"
                className="w-56 h-56 rounded-xl"
              />
              {!canAccess && (
                <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center">
                  <div className="text-center">
                    <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-1" />
                    <p className="text-xs text-destructive font-medium">Abbonamento non attivo</p>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Codice</p>
            <p className="font-mono text-sm font-medium">{qr?.codice}</p>
          </div>
        </CardContent>
      </Card>

      {/* Subscription status */}
      <Card className="border-0 shadow-sm w-full max-w-xs">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Stato abbonamento</span>
            {activeSub ? <StatusBadge status={activeSub.status} /> : <Badge variant="destructive">Nessuno</Badge>}
          </div>
          {activeSub && (
            <p className="text-xs text-muted-foreground mt-1">
              {activeSub.plan_name} — scade il {moment(activeSub.end_date).format("D MMM YYYY")}
            </p>
          )}
          {canAccess ? (
            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
              <CheckCircle className="w-4 h-4" /> Accesso consentito
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4" /> Accesso non consentito
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Il QR è personale e non cambia nel tempo. La validità viene verificata alla scansione in base allo stato del tuo abbonamento.
      </p>
    </div>
  );
}