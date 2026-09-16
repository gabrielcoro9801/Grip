import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { SESSI, etichettaSesso } from "@/core/domain/anagrafica";
import {
  MESI, filtraContatti, contaPer, contattiPerMese, anniDisponibili, anniNascitaDisponibili,
} from "@/core/domain/lead";

// Radix non accetta una voce con valore vuoto: "tutti" è il filtro spento.
const TUTTI = "tutti";
const FILTRI_VUOTI = { anno: TUTTI, mese: TUTTI, sesso: TUTTI, annoNascita: TUTTI, canaleId: TUTTI };

const numero = new Intl.NumberFormat("it-IT");

function Filtro({ id, etichetta, valore, onChange, voci, disabilitato }) {
  return (
    <div className="min-w-[9rem] flex-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{etichetta}</Label>
      <Select value={valore} onValueChange={onChange} disabled={disabilitato}>
        <SelectTrigger id={id} className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TUTTI}>Tutti</SelectItem>
          {voci.map((v) => <SelectItem key={v.valore} value={String(v.valore)}>{v.etichetta}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * I contatti per mese, a colonne.
 *
 * Una serie sola, quindi niente legenda: il titolo dice cosa si guarda. Il numero sta sulla
 * colonna più alta e su quella del mese scelto; gli altri li danno il tooltip (anche da
 * tastiera) e la tabella, così nessun valore dipende dal passaggio del mouse.
 */
function ColonneMesi({ serie, meseEvidenziato }) {
  const [attivo, setAttivo] = useState(null);
  const massimo = Math.max(...serie.map((m) => m.totale), 0);
  const indiceMassimo = massimo > 0 ? serie.findIndex((m) => m.totale === massimo) : -1;
  const ALTEZZA = 160;

  return (
    <div className="relative">
      <div className="flex items-end gap-1 border-b border-border" style={{ height: ALTEZZA + 24 }} role="list" aria-label="Contatti per mese">
        {serie.map((m, i) => {
          const h = massimo ? Math.round((m.totale / massimo) * ALTEZZA) : 0;
          const evidenziato = meseEvidenziato === null || meseEvidenziato === m.mese;
          const etichetta = m.totale > 0 && (i === indiceMassimo || meseEvidenziato === m.mese);
          return (
            <div
              key={m.mese}
              role="listitem"
              tabIndex={0}
              aria-label={`${m.etichetta}: ${m.totale} ${m.totale === 1 ? "contatto" : "contatti"}`}
              className="relative flex-1 h-full flex flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              onPointerEnter={() => setAttivo(i)}
              onPointerLeave={() => setAttivo(null)}
              onFocus={() => setAttivo(i)}
              onBlur={() => setAttivo(null)}
            >
              {etichetta && <span className="text-xs font-medium text-foreground mb-1 tabular-nums">{numero.format(m.totale)}</span>}
              <div
                className={`w-full max-w-[24px] rounded-t-[4px] transition-opacity ${evidenziato ? "bg-primary" : "bg-primary/30"}`}
                style={{ height: h }}
              />
              {attivo === i && (
                <div role="tooltip" className="absolute bottom-full mb-2 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md pointer-events-none">
                  <span className="font-semibold text-foreground tabular-nums">{numero.format(m.totale)}</span>
                  <span className="text-muted-foreground"> · {m.etichetta}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1.5" aria-hidden="true">
        {serie.map((m) => (
          <span key={m.mese} className="flex-1 text-center text-[11px] text-muted-foreground">{m.etichetta.slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
}

/** Una ripartizione a barre orizzontali, col valore in punta. Poche voci: tutte etichettate. */
function BarreRipartizione({ righe, totale, vuoto }) {
  if (!righe.length) return <p className="text-sm text-muted-foreground py-4 text-center">{vuoto}</p>;
  const massimo = Math.max(...righe.map((r) => r.totale));
  return (
    <ul className="space-y-2.5">
      {righe.map((r) => {
        const quota = totale ? Math.round((r.totale / totale) * 100) : 0;
        return (
          <li key={r.chiave} className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3">
            <span className="text-sm text-foreground truncate" title={r.etichetta}>{r.etichetta}</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-4 rounded-r-[4px] bg-primary" style={{ width: `${(r.totale / massimo) * 80}%` }} aria-hidden="true" />
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                <span className="font-medium text-foreground">{numero.format(r.totale)}</span> · {quota}%
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Andamento() {
  const [leads, setLeads] = useState([]);
  const [canali, setCanali] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);
  const [filtri, setFiltri] = useState(FILTRI_VUOTI);
  const [tabella, setTabella] = useState(false);

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([api.entities.Lead.list(), api.entities.CanaleContatto.list("nome")])
      .then(([l, c]) => { setLeads(l); setCanali(c); })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const attivi = useMemo(
    () => Object.fromEntries(Object.entries(filtri).map(([k, v]) => [k, v === TUTTI ? null : v])),
    [filtri]
  );
  const filtrati = useMemo(() => filtraContatti(leads, attivi), [leads, attivi]);

  const anni = anniDisponibili(leads);
  // Il grafico dei mesi ha bisogno di un anno: quello scelto, o il più recente con contatti.
  const annoGrafico = attivi.anno ? Number(attivi.anno) : (anni[0] ?? new Date().getFullYear());
  // I mesi si contano con tutti i filtri tranne il mese stesso, che invece si evidenzia:
  // filtrare anche per mese lascerebbe una colonna sola.
  const perMese = useMemo(
    () => contattiPerMese(filtraContatti(leads, { ...attivi, mese: null }), annoGrafico),
    [leads, attivi, annoGrafico]
  );

  const nomeCanale = new Map(canali.map((c) => [c.id, c.nome]));
  const perCanale = contaPer(filtrati, "canale_id").map((r) => ({ chiave: r.valore, etichetta: nomeCanale.get(r.valore) ?? "—", totale: r.totale }));
  const perSesso = contaPer(filtrati, "sesso").map((r) => ({ chiave: r.valore, etichetta: etichettaSesso(r.valore), totale: r.totale }));

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  const imposta = (campo) => (valore) => setFiltri({ ...filtri, [campo]: valore });
  const qualcheFiltro = Object.values(filtri).some((v) => v !== TUTTI);
  const descrizioneFiltri = [
    attivi.mese ? MESI[Number(attivi.mese) - 1] : null,
    attivi.anno,
    attivi.sesso ? etichettaSesso(attivi.sesso) : null,
    attivi.annoNascita ? `nati nel ${attivi.annoNascita}` : null,
    attivi.canaleId ? nomeCanale.get(attivi.canaleId) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Andamento dei contatti" description="Quanti contatti arrivano, quando, da quali canali e di chi." />

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtri">
        <Filtro id="f-anno" etichetta="Anno" valore={filtri.anno} onChange={imposta("anno")} voci={anni.map((a) => ({ valore: a, etichetta: String(a) }))} />
        <Filtro id="f-mese" etichetta="Mese" valore={filtri.mese} onChange={imposta("mese")} voci={MESI.map((m, i) => ({ valore: i + 1, etichetta: m }))} />
        <Filtro id="f-sesso" etichetta="Sesso" valore={filtri.sesso} onChange={imposta("sesso")} voci={SESSI} />
        <Filtro
          id="f-nascita"
          etichetta="Anno di nascita"
          valore={filtri.annoNascita}
          onChange={imposta("annoNascita")}
          voci={anniNascitaDisponibili(leads).map((a) => ({ valore: a, etichetta: String(a) }))}
        />
        <Filtro id="f-canale" etichetta="Canale" valore={filtri.canaleId} onChange={imposta("canaleId")} voci={canali.map((c) => ({ valore: c.id, etichetta: c.nome }))} />
        {qualcheFiltro && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setFiltri(FILTRI_VUOTI)}>Azzera filtri</Button>
        )}
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">Contatti</p>
          <p className="text-5xl font-semibold tracking-tight text-foreground mt-1" data-testid="numero-contatti">{numero.format(filtrati.length)}</p>
          <p className="text-sm text-muted-foreground mt-2">{descrizioneFiltri || "Tutti i contatti registrati"}</p>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base font-heading">Contatti per mese — {annoGrafico}</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setTabella(!tabella)} aria-pressed={tabella}>
            {tabella ? "Mostra grafico" : "Mostra tabella"}
          </Button>
        </CardHeader>
        <CardContent>
          {tabella ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-medium text-muted-foreground">Mese</th>
                    <th className="py-2 font-medium text-muted-foreground text-right">Contatti</th>
                  </tr>
                </thead>
                <tbody>
                  {perMese.map((m) => (
                    <tr key={m.mese} className="border-b border-border/50">
                      <td className="py-1.5 pr-4">{m.etichetta}</td>
                      <td className="py-1.5 text-right tabular-nums">{numero.format(m.totale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ColonneMesi serie={perMese} meseEvidenziato={attivi.mese ? Number(attivi.mese) : null} />
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Per canale</CardTitle></CardHeader>
          <CardContent>
            <BarreRipartizione righe={perCanale} totale={filtrati.length} vuoto="Nessun contatto" />
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base font-heading">Per sesso</CardTitle></CardHeader>
          <CardContent>
            <BarreRipartizione righe={perSesso} totale={filtrati.length} vuoto="Nessun contatto" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
