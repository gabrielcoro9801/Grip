import React, { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { caricaNotifiche, segnaNotificheLette } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Bell, CalendarX } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";

// Un'icona per tipo: oggi ce n'è uno solo, ma la pagina non deve saperlo.
const ICONE = { lezione_annullata: CalendarX };

/**
 * Gli avvisi della palestra al socio: oggi, le lezioni prenotate che sono state annullate.
 *
 * Aprire la pagina le segna tutte come lette, come in qualunque app: la campanella si spegne. Le
 * nuove restano evidenziate finché si resta qui, così si vede quali sono arrivate dall'ultima volta.
 */
export default function MemberNotifiche() {
  const { impostaNonLette } = useOutletContext() ?? {};
  const [notifiche, setNotifiche] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(() => {
    setLoading(true);
    setErrore(null);
    caricaNotifiche()
      .then(async ({ notifiche: elenco, non_lette: nonLette }) => {
        setNotifiche(elenco);
        if (nonLette > 0) {
          await segnaNotificheLette();
          impostaNonLette?.(0);
        }
      })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, [impostaNonLette]);

  useEffect(() => { carica(); }, [carica]);

  if (loading) return <LoadingState minHeight="p-8" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Notifiche</h1>
        <p className="text-sm text-muted-foreground">Gli avvisi della palestra per te</p>
      </div>

      {notifiche.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <Bell className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nessuna notifica</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {notifiche.map((n) => {
            const Icona = ICONE[n.tipo] ?? Bell;
            return (
              <li key={n.id}>
                <Card className={`border-0 shadow-sm ${n.letta ? "" : "ring-1 ring-primary/40 bg-primary/5"}`}>
                  <CardContent className="p-4 flex gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${n.letta ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>
                      <Icona className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {n.titolo}
                          {!n.letta && <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-primary">Nuova</span>}
                        </p>
                        <time className="text-xs text-muted-foreground shrink-0" dateTime={n.creata_il}>{formatData(n.creata_il, "breve")}</time>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{n.testo}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
