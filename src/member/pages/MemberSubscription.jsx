import React, { useState, useEffect } from "react";
import { caricaAbbonamenti, richiediRinnovo } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Calendar, AlertCircle, CheckCircle, Clock, CreditCard, PauseCircle, Send } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatData, formatDataOra, formatEuro } from "@/core/domain/format";

/**
 * "Richiedi il rinnovo": il socio dice che vuole rinnovare, e la reception lo richiama e incassa
 * di persona. Niente pagamenti online e nessun messaggio che parte: una riga nel suo diario, e lui
 * in cima alla lista di Da fare. Finché la reception non lo sente, qui legge che la richiesta è arrivata.
 */
function RichiestaRinnovo({ richiesta, onInviata }) {
  const { toast } = useToast();
  const [invio, setInvio] = useState(false);
  if (richiesta) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <CheckCircle className="w-5 h-5 text-success shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Richiesta di rinnovo inviata</p>
            <p className="text-muted-foreground">L'abbiamo ricevuta il {formatDataOra(richiesta.il)}: la reception ti contatterà per rinnovare.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  const invia = async () => {
    setInvio(true);
    try {
      const { richiesta_rinnovo: r } = await richiediRinnovo();
      onInviata(r);
    } catch (err) {
      toast({ title: "Richiesta non inviata", description: err.message, variant: "destructive" });
    }
    setInvio(false);
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">Vuoi rinnovare?</p>
          <p className="text-muted-foreground">Mandaci la richiesta: la reception ti contatta e lo sistemate insieme.</p>
        </div>
        <Button onClick={invia} disabled={invio} className="shrink-0"><Send className="w-4 h-4 mr-1" /> Richiedi il rinnovo</Button>
      </CardContent>
    </Card>
  );
}

export default function MemberSubscription() {
  const [dati, setDati] = useState(null);

  useEffect(() => {
    caricaAbbonamenti()
      .then(setDati)
      .catch(() => setDati({ abbonamenti: [], richiesta_rinnovo: null }));
  }, []);

  if (!dati) {
    return <LoadingState minHeight="p-8" />;
  }
  const subscriptions = dati.abbonamenti;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Abbonamento</h1>
        <p className="text-sm text-muted-foreground">Stato del tuo abbonamento</p>
      </div>

      <RichiestaRinnovo richiesta={dati.richiesta_rinnovo} onInviata={(r) => setDati((d) => ({ ...d, richiesta_rinnovo: r }))} />

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
            const sospensione = sub.sospensioni?.[0];
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
                  {sospensione && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border text-xs">
                      <PauseCircle className="w-4 h-4" />
                      Sospeso dal {formatData(sospensione.dal, "breve")}: riprende il {formatData(sospensione.riprende_il, "breve")}, e la scadenza slitta di altrettanto.
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
                  {sub.giorni_sospesi > 0 && (
                    <p className="text-xs text-muted-foreground">Allungato di {sub.giorni_sospesi} giorni per le sospensioni.</p>
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
        Il pagamento e le modifiche si fanno in reception.
      </p>
    </div>
  );
}
