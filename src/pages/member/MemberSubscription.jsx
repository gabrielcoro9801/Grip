import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, AlertCircle, CheckCircle, Clock, CreditCard } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData, formatEuro } from "@/lib/format";

export default function MemberSubscription() {
  const { memberUser } = useMemberAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberUser?.member_id) return;
    api.entities.Subscription.filter({ member_id: memberUser.member_id }, "-start_date").then(subs => {
      setSubscriptions(subs);
      setLoading(false);
    });
  }, [memberUser?.member_id]);

  if (loading) {
    return <LoadingState minHeight="p-8" />;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Abbonamento</h1>
        <p className="text-sm text-muted-foreground">Stato del tuo abbonamento</p>
      </div>

      {subscriptions.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <CreditCard className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nessun abbonamento attivo</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {subscriptions.map(sub => {
            const daysToExpiry = moment(sub.end_date).diff(moment(), "days");
            const expiringSoon = daysToExpiry <= 7 && daysToExpiry >= 0;
            const expired = daysToExpiry < 0;
            return (
              <Card key={sub.id} className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{sub.plan_name}</h3>
                    <StatusBadge status={sub.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-4 h-4" /> Inizio
                      <span className="font-medium text-foreground ml-1">{formatData(sub.start_date, "media")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-4 h-4" /> Scadenza
                      <span className="font-medium text-foreground ml-1">{formatData(sub.end_date, "media")}</span>
                    </div>
                  </div>
                  {sub.sessions_remaining != null && (
                    <div className="text-sm text-muted-foreground">
                      Ingressi residui: <span className="font-medium text-foreground">{sub.sessions_remaining}</span>
                    </div>
                  )}
                  {expired ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                      <AlertCircle className="w-4 h-4" /> Abbonamento scaduto
                    </div>
                  ) : expiringSoon ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
                      <Clock className="w-4 h-4" /> In scadenza tra {daysToExpiry} giorni
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/30 text-success text-xs">
                      <CheckCircle className="w-4 h-4" /> Attivo — scade tra {daysToExpiry} giorni
                    </div>
                  )}
                  {sub.price_paid != null && (
                    <p className="text-xs text-muted-foreground">Importo pagato: {formatEuro(sub.price_paid)}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground text-center pt-2">
        Per rinnovi o modifiche, rivolgiti alla reception.
      </p>
    </div>
  );
}