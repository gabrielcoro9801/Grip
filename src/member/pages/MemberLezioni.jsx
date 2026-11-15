import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { caricaLezioni, caricaFisse, terminaFissa } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { ChevronDown } from "lucide-react";
import { LeMieFisse, FoglioFissa } from "@/member/components/fisse";
import { usePalestra } from "@/member/components/Palestra";
import { RigaLezione, AggiungiAlCalendario, useDisdici, usePrenota, nomeLezione, viva } from "@/member/components/lezioni";
import { giornoLezione, quandoIstante } from "@/core/domain/format";

// Le mie lezioni (docs/piani/portale.md, D-3): i posti offerti da confermare, le fisse, le
// prossime per giorno con Disdici o Esci dalla lista e il calendario, e le passate degli ultimi
// 30 giorni, con le disdette e le annullate dalla palestra.

/** I posti offerti dalla lista d'attesa: in cima, perché scadono. */
function Offerte({ lezioni, onConferma, onEsci, inCorso }) {
  if (!lezioni.length) return null;
  return (
    <section aria-label="Posti offerti" className="space-y-2">
      {lezioni.map((l) => (
        <div key={l.id} className="rounded-lg border border-success/40 bg-success/10 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Si è liberato un posto: {nomeLezione(l)}</p>
            <p className="text-sm text-muted-foreground">È tuo se lo confermi entro {quandoIstante(l.mia_prenotazione.posto_offerto_fino_a)}; poi passa al prossimo in lista.</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 min-h-11" disabled={inCorso} onClick={() => onConferma(l)}>Conferma</Button>
            <Button variant="outline" className="flex-1 min-h-11" disabled={inCorso} onClick={() => onEsci(l)}>Esci dalla lista</Button>
          </div>
        </div>
      ))}
    </section>
  );
}

export default function MemberLezioni() {
  const { toast } = useToast();
  const palestra = usePalestra();
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  // Il foglio della fissa da cambiare: { fissa, al }. «Allunga» dalla notifica arriva con
  // ?allunga=<id>, e il foglio si apre già con il nuovo massimo.
  const [cambio, setCambio] = useState(null);
  const [parametri, setParametri] = useSearchParams();

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([caricaLezioni(), caricaFisse()])
      .then(([lezioni, fisse]) => setDati({ lezioni, fisse }))
      .catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);
  useEffect(() => {
    const id = parametri.get("allunga");
    const f = id && dati?.fisse.find((x) => x.id === id);
    if (!f) return;
    setCambio({ fissa: f, al: f.massimo && f.massimo > f.al ? f.massimo : null });
    setParametri({}, { replace: true });
  }, [parametri, dati, setParametri]);
  const [disdici, dialogoDisdici, disdicendo] = useDisdici(carica);
  const [prenota, prenotando] = usePrenota(carica);
  const inCorso = disdicendo || prenotando;

  const termina = async (fissa) => {
    try {
      const esito = await terminaFissa(fissa.id);
      toast({
        title: `Prenotazione fissa terminata: ${fissa.corso}`,
        description: esito.rimaste
          ? `${esito.disdette} lezioni disdette; ${esito.rimaste} sono oltre il termine di disdetta e restano prenotate.`
          : `${esito.disdette} ${esito.disdette === 1 ? "lezione disdetta" : "lezioni disdette"}.`,
      });
      carica();
    } catch (err) {
      toast({ title: "Non terminata", description: err.message, variant: "destructive" });
    }
  };

  if (errore) return <ErrorState error={errore} onRetry={carica} className="p-8" />;
  if (!dati) return <LoadingState minHeight="p-8" />;

  const future = dati.lezioni.filter((l) => !l.finita);
  const prossime = future.filter((l) => viva(l.mia_prenotazione) || l.annullata);
  const offerte = prossime.filter((l) => l.mia_prenotazione?.posto_offerto_fino_a);
  const passate = dati.lezioni.filter((l) => l.finita).reverse();
  const prenotate = {};
  for (const l of prossime) if (l.mia_prenotazione?.fissa && viva(l.mia_prenotazione)) prenotate[l.sessione_id] = (prenotate[l.sessione_id] ?? 0) + 1;
  const perGiorno = new Map();
  for (const l of prossime) {
    if (!perGiorno.has(l.data)) perGiorno.set(l.data, []);
    perGiorno.get(l.data).push(l);
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <h1 className="text-xl font-heading font-bold">Le mie lezioni</h1>

      <Offerte lezioni={offerte} onConferma={prenota} onEsci={disdici} inCorso={inCorso} />

      <LeMieFisse fisse={dati.fisse} prenotate={prenotate} onTermina={termina} onCambia={(fissa, al = null) => setCambio({ fissa, al })} />
      {cambio && (
        <FoglioFissa
          sessione={{ id: cambio.fissa.serie_id, corso: cambio.fissa.corso, giorno: cambio.fissa.giorni[0], inizio: cambio.fissa.inizio }}
          fissa={cambio.fissa} alIniziale={cambio.al} onChiudi={() => setCambio(null)} onFatto={carica}
        />
      )}

      <section aria-labelledby="titolo-prossime" className="space-y-2">
        <h2 id="titolo-prossime" className="text-sm font-semibold">Prossime</h2>
        {perGiorno.size === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Nessuna lezione prenotata</p>
              <Button asChild className="min-h-11"><Link to="/member-portal/corsi">Prenota una lezione</Link></Button>
            </CardContent>
          </Card>
        ) : (
          [...perGiorno.entries()].map(([data, lezioni]) => (
            <div key={data}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{giornoLezione(data)}</h3>
              <Card className="border-0 shadow-sm">
                <CardContent className="px-4 py-1">
                  <ul className="divide-y divide-border">
                    {lezioni.map((l) => (
                      <RigaLezione key={l.id} lezione={l} senzaGiorno>
                        {!l.annullata && <AggiungiAlCalendario lezione={l} palestra={palestra} compatto />}
                        {!l.annullata && !l.motivo_disdetta_chiusa && (
                          <Button size="sm" variant="ghost" className="min-h-11" disabled={inCorso} onClick={() => disdici(l)}>
                            {l.mia_prenotazione.stato === "waitlisted" ? "Esci dalla lista" : "Disdici"}
                          </Button>
                        )}
                      </RigaLezione>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          ))
        )}
      </section>

      {passate.length > 0 && (
        <details className="group">
          <summary className="list-none cursor-pointer min-h-11 flex items-center gap-2 text-sm font-semibold">
            Passate, ultimi 30 giorni ({passate.length})
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <Card className="border-0 shadow-sm mt-1">
            <CardContent className="px-4 py-1">
              <ul className="divide-y divide-border">
                {passate.map((l) => <RigaLezione key={l.id} lezione={l} />)}
              </ul>
            </CardContent>
          </Card>
        </details>
      )}
      {dialogoDisdici}
    </div>
  );
}
