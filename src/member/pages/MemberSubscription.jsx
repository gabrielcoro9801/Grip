import React, { useState, useEffect } from "react";
import { caricaAbbonamenti } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Calendar, AlertCircle, CheckCircle, Clock, CreditCard } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { formatData, formatEuro } from "@/core/domain/format";

export default function MemberSubscription() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    caricaAbbonamenti()
      .then(setSubscriptions)
      .finally(() => setLoading(false));
  }, []);

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
            // Quanto manca alla scadenza lo conta il server: qui resta solo come dirlo.
            const daysToExpiry = sub.giorni_alla_scadenza;
            const expired = daysToExpiry != null && daysToExpiry < 0;
            const expiringSoon = daysToExpiry != null && daysToExpiry <= 7 && daysToExpiry >= 0;
            return (
              <Card key={sub.id} className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{sub.piano}</h3>
                    <StatusBadge status={sub.stato} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-4 h-4" /> Inizio
                      <span className="font-medium text-foreground ml-1">{formatData(sub.inizio, "media")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-4 h-4" /> Scadenza
                      <span className="font-medium text-foreground ml-1">{formatData(sub.fine, "media")}</span>
                    </div>
                  </div>
                  {sub.ingressi_residui != null && (
                    <div className="text-sm text-muted-foreground">
                      Ingressi residui: <span className="font-medium text-foreground">{sub.ingressi_residui}</span>
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
                  {sub.prezzo_pagato != null && (
                    <p className="text-xs text-muted-foreground">Importo pagato: {formatEuro(sub.prezzo_pagato)}</p>
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