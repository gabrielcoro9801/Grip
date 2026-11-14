import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { caricaMieProssime, caricaFisse, terminaFissa } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { LeMieFisse } from "@/member/components/fisse";
import { RigaLezione, useDisdici } from "@/member/components/lezioni";
import { giornoLezione } from "@/core/domain/format";

// Le mie lezioni, prima forma (D-2): le prossime prenotazioni dei 30 giorni, con Disdici, e le
// fisse. In D-3 arrivano lo storico, le disdette con il motivo e «Aggiungi al calendario»
// (docs/piani/portale.md).
export default function MemberLezioni() {
  const { toast } = useToast();
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([caricaMieProssime(), caricaFisse()])
      .then(([lezioni, fisse]) => setDati({ lezioni, fisse }))
      .catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);
  const [disdici, dialogoDisdici, inCorso] = useDisdici(carica);

  const termina = async (fissa) => {
    try {
      const { disdette } = await terminaFissa(fissa.id);
      toast({ title: "Prenotazione fissa terminata", description: disdette ? `Disdette le prossime ${disdette} lezioni.` : undefined });
      carica();
    } catch (err) {
      toast({ title: "Non terminata", description: err.message, variant: "destructive" });
    }
  };

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-heading font-bold">Le mie lezioni</h1>

      <LeMieFisse fisse={dati.fisse} onTermina={termina} />

      <section aria-labelledby="titolo-prossime" className="space-y-1">
        <h2 id="titolo-prossime" className="text-sm font-semibold">Prossime</h2>
        <Card className="border-0 shadow-sm">
          <CardContent className="px-4 py-1">
            {dati.lezioni.length === 0 ? (
              <div className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Nessuna lezione prenotata</p>
                <Button asChild className="min-h-11"><Link to="/member-portal/corsi">Prenota una lezione</Link></Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {dati.lezioni.map((l) => (
                  <RigaLezione key={l.id} lezione={l}>
                    {!l.motivo_disdetta_chiusa && (
                      <Button size="sm" variant="ghost" disabled={inCorso} onClick={() => disdici(l)} aria-label={`Disdici ${l.corso?.nome ?? "la lezione"}, ${giornoLezione(l.data)}`}>
                        Disdici
                      </Button>
                    )}
                  </RigaLezione>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
      {dialogoDisdici}
    </div>
  );
}
