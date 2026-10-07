import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useTema } from "@/ui/tema";
import { formatData } from "@/core/domain/format";
import { variazione } from "@/core/domain/lead";
import { COLORI, Riquadro, useSuggerimento, n } from "@/staff/components/lead/andamento/comuni";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const ALTEZZA = 140;
const GRADINI = 5;
const gradino = (v, massimo) => (v <= 0 || massimo <= 0 ? 0 : Math.max(1, Math.ceil((v / massimo) * GRADINI)));

function Numero({ etichetta, valore, children }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 space-y-1">
        <p className="text-sm text-muted-foreground">{etichetta}</p>
        <p className="text-3xl font-semibold font-heading">{valore}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Come si frequenta la palestra: quanti ingressi, quando c'è gente, e chi non viene più. Gli
 * stessi colori e gli stessi pezzi di Andamento dei lead; i numeri vengono dal server
 * (/api/ingressi/statistiche).
 */
export default function AndamentoIngressi() {
  const [giorni, setGiorni] = useState(30);
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const { tema } = useTema();
  const colonne = useSuggerimento();
  const caselle = useSuggerimento();

  useEffect(() => {
    setErrore(null);
    api.ingressi.statistiche(giorni).then(setDati).catch(setErrore);
  }, [giorni]);

  if (errore) return <ErrorState error={errore} onRetry={() => setGiorni((g) => g)} />;
  if (!dati) return <LoadingState minHeight="h-64" />;

  const v = variazione(dati.totale, dati.totalePrima);
  const massimo = Math.max(1, ...dati.perGiorno.map((g) => g.ingressi));
  const picco = Math.max(0, ...dati.mappa.flat());
  const testoChiaro = (g) => (tema === "scuro" ? g <= 3 : g >= 3);

  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="group" aria-label="Periodo">
        {[30, 90].map((g) => (
          <button
            key={g} type="button" aria-pressed={giorni === g} onClick={() => setGiorni(g)}
            className={`px-3 py-1.5 rounded-full text-sm border ${giorni === g ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
          >
            Ultimi {g} giorni
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Numero etichetta="Ingressi" valore={n(dati.totale)}>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {v === null ? "Nessun ingresso nel periodo prima" : (
              <>
                {v >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" /> : <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />}
                <span className="font-medium text-foreground">{v >= 0 ? "+" : ""}{Math.round(v * 100)}%</span> sui {giorni} giorni prima ({n(dati.totalePrima)})
              </>
            )}
          </p>
        </Numero>
        <Numero etichetta="Soci entrati" valore={n(dati.soci)}><p className="text-xs text-muted-foreground">Almeno una volta nel periodo</p></Numero>
        <Numero etichetta="Frequenza media" valore={dati.frequenzaSettimanale === null ? "—" : String(dati.frequenzaSettimanale).replace(".", ",")}>
          <p className="text-xs text-muted-foreground">Ingressi a settimana per socio entrato</p>
        </Numero>
        <Numero etichetta="A rischio di abbandono" valore={n(dati.rischio.length)}>
          <p className="text-xs text-muted-foreground">Abbonamento valido, nessun ingresso da {dati.sogliaRischio} giorni</p>
        </Numero>
      </div>

      <Riquadro titolo="Ingressi al giorno" sottotitolo={`Dal ${formatData(dati.dal, "breve")} a oggi`}>
        <div className="relative" data-grafico>
          <ul className="flex items-end gap-[2px]" style={{ height: ALTEZZA }} aria-label="Ingressi per giorno">
            {dati.perGiorno.map((g) => (
              <li
                key={g.data} tabIndex={0}
                className="flex-1 min-w-0 rounded-t-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                style={{ height: g.ingressi ? Math.max(2, (g.ingressi / massimo) * ALTEZZA) : 0, background: COLORI.contatti }}
                aria-label={`${formatData(g.data, "giorno")}: ${g.ingressi} ingressi, ${g.soci} soci`}
                {...colonne.eventi(<p><span className="font-medium">{formatData(g.data, "giorno")}</span>: {n(g.ingressi)} ingressi · {n(g.soci)} soci</p>)}
              />
            ))}
          </ul>
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5" aria-hidden="true">
            <span>{formatData(dati.dal, "breve").slice(0, 5)}</span>
            <span>picco {n(massimo)} al giorno</span>
            <span>oggi</span>
          </div>
          {colonne.elemento}
        </div>
      </Riquadro>

      <div className="grid lg:grid-cols-2 gap-6">
        <Riquadro
          titolo="Quando c'è gente"
          sottotitolo="Ingressi per giorno della settimana e fascia oraria"
          azioni={(
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground" aria-hidden="true">
              meno {Array.from({ length: GRADINI }, (_, i) => <span key={i} className="w-3.5 h-3.5 rounded-[3px]" style={{ background: `var(--viz-scala-${i + 1})` }} />)} più
            </div>
          )}
        >
          <div className="relative overflow-x-auto" data-grafico>
            <table className="w-full border-separate border-spacing-[2px] text-[11px]">
              <thead>
                <tr>
                  <th><span className="sr-only">Giorno</span></th>
                  {dati.fasce.map((f) => <th key={f} scope="col" className="font-medium text-muted-foreground">{f}</th>)}
                </tr>
              </thead>
              <tbody>
                {dati.mappa.map((riga, i) => (
                  <tr key={dati.giorniSettimana[i]}>
                    <th scope="row" className="text-left font-normal text-xs pr-2">{dati.giorniSettimana[i]}</th>
                    {riga.map((valore, j) => {
                      const g = gradino(valore, picco);
                      return (
                        <td
                          key={j} tabIndex={valore ? 0 : -1}
                          className={`h-7 min-w-[2rem] rounded-[4px] text-center tabular-nums ${g === 0 ? "bg-muted/50 text-muted-foreground/60" : ""}`}
                          style={g ? { background: `var(--viz-scala-${g})`, color: testoChiaro(g) ? "#ffffff" : "#0b0b0b" } : undefined}
                          {...caselle.eventi(<p>{dati.giorniSettimana[i]}, {dati.fasce[j]}: {n(valore)} ingressi</p>)}
                        >
                          {valore || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {caselle.elemento}
          </div>
        </Riquadro>

        <Riquadro titolo="Chi non viene più" sottotitolo={`Abbonamento valido, nessun ingresso da almeno ${dati.sogliaRischio} giorni: una telefonata ora vale un rinnovo dopo`}>
          {dati.rischio.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nessuno: tutti i soci con l'abbonamento valido sono entrati di recente.</p>
          ) : (
            <ul className="divide-y divide-border max-h-80 overflow-y-auto">
              {dati.rischio.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <Link to={`/crm/soci/${r.id}`} className="truncate hover:underline">{r.nome}</Link>
                  <span className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    {r.telefono && <a href={`tel:${r.telefono}`} className="text-primary hover:underline">{r.telefono}</a>}
                    <span className="tabular-nums">{r.giorni === null ? "mai entrato" : `da ${r.giorni} giorni`}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Riquadro>
      </div>
    </div>
  );
}
