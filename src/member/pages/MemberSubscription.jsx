import React, { useState, useEffect, useCallback } from "react";
import { caricaAbbonamenti } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { CreditCard, PauseCircle } from "lucide-react";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { formatData } from "@/core/domain/format";
import { giorniFra, oggiIso } from "@/core/domain/giorni";
import { usePalestra, PulsantiContatto, OrariReception } from "@/member/components/Palestra";

// Abbonamento come una scheda (docs/piani/portale.md, D-2): in cima quello corrente, con fino a
// quando vale e fino a quando si prenota; come rinnovare; le sospensioni; sotto lo storico. Niente
// importo pagato: per prenotare non serve.

const mancano = (g) => (g === 0 ? "Scade oggi" : g === 1 ? "Manca 1 giorno" : `Mancano ${g} giorni`);

function Corrente({ sub, prenotabileFino }) {
  const oggi = oggiIso();
  const scaduto = sub.giorni_alla_scadenza < 0;
  const totale = Math.max(1, giorniFra(sub.inizio, sub.fine) + 1);
  const passati = Math.min(totale, Math.max(0, giorniFra(sub.inizio, oggi) + 1));
  const barra = scaduto ? "bg-destructive" : sub.in_scadenza ? "bg-warning" : "bg-success";
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading font-bold">{sub.piano}</h2>
          <StatusBadge status={sub.stato} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Dal {formatData(sub.inizio, "lungo")}</p>
          <p className={`text-lg font-semibold ${scaduto ? "text-destructive" : ""}`}>
            {scaduto ? "Scaduto il" : "Valido fino al"} {formatData(sub.fine, "lungo")}
          </p>
        </div>
        <div
          role="progressbar" aria-label="Giorni passati dell'abbonamento"
          aria-valuemin={0} aria-valuemax={totale} aria-valuenow={passati}
          className="h-2 rounded-full bg-muted overflow-hidden"
        >
          <div className={`h-full ${barra}`} style={{ width: `${(passati / totale) * 100}%` }} />
        </div>
        {!scaduto && (
          <p className="text-sm text-muted-foreground">
            {mancano(sub.giorni_alla_scadenza)}
            {sub.giorni_sospesi > 0 && ` · allungato di ${sub.giorni_sospesi} ${sub.giorni_sospesi === 1 ? "giorno" : "giorni"} per una sospensione`}
          </p>
        )}
        {prenotabileFino && prenotabileFino !== "9999-12-31" && (
          <p className="text-sm">Puoi prenotare lezioni fino al <span className="font-medium">{formatData(prenotabileFino, "lungo")}</span></p>
        )}
      </CardContent>
    </Card>
  );
}

function Sospensioni({ sospensioni }) {
  if (!sospensioni.length) return null;
  return (
    <section aria-labelledby="titolo-sospensioni" className="space-y-1">
      <h2 id="titolo-sospensioni" className="text-sm font-semibold">Sospensioni</h2>
      <Card className="border-0 shadow-sm">
        <CardContent className="px-4 py-1">
          <ul className="divide-y divide-border">
            {sospensioni.map((s) => {
              const giorni = giorniFra(s.dal, s.al) + 1;
              return (
                <li key={`${s.dal}-${s.al}`} className="flex items-start gap-3 py-3">
                  <PauseCircle className="w-4 h-4 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  <div className="text-sm">
                    <p className="font-medium">Dal {formatData(s.dal, "lungo")} al {formatData(s.al, "lungo")}</p>
                    <p className="text-muted-foreground">Ritorno il {formatData(s.riprende_il, "lungo")}: {giorni} {giorni === 1 ? "giorno aggiunto" : "giorni aggiunti"} alla scadenza</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export default function MemberSubscription() {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const palestra = usePalestra();

  // Un errore di rete si dice: prima diventava "Nessun abbonamento valido", a chi ce l'ha.
  const carica = useCallback(() => {
    setErrore(null);
    caricaAbbonamenti().then(setDati).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;

  // Il corrente è il più recente ancora valido, altrimenti l'ultimo: la stessa regola della Home.
  const tutti = dati.abbonamenti;
  const corrente = tutti.find((a) => a.stato !== "expired") ?? tutti[0] ?? null;
  const storico = tutti.filter((a) => a !== corrente);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-heading font-bold">Abbonamento</h1>

      {corrente ? (
        <Corrente sub={corrente} prenotabileFino={dati.prenotabile_fino_al} />
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <CreditCard className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nessun abbonamento</p>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">{corrente ? "Per rinnovare passa in reception" : "Per abbonarti passa in reception"}</p>
          <OrariReception palestra={palestra} />
          <PulsantiContatto palestra={palestra} />
        </CardContent>
      </Card>

      {corrente && <Sospensioni sospensioni={corrente.sospensioni ?? []} />}

      {storico.length > 0 && (
        <section aria-labelledby="titolo-storico" className="space-y-1">
          <h2 id="titolo-storico" className="text-sm font-semibold">Storico</h2>
          <Card className="border-0 shadow-sm">
            <CardContent className="px-4 py-1">
              <ul className="divide-y divide-border">
                {storico.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.piano}</p>
                      <p className="text-xs text-muted-foreground">{formatData(a.inizio, "breve")} – {formatData(a.fine, "breve")}</p>
                    </div>
                    {/* Un abbonamento vecchio è finito, non «scaduto»: il rosso è solo per il corrente. */}
                    {a.stato === "expired" ? <StatusBadge label="Finito" tone="neutro" /> : <StatusBadge status={a.stato} />}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
