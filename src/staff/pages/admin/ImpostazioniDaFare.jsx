import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Checkbox } from "@/ui/primitivi/checkbox";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { LINEE, etichettaSegnale, regolaSegnale } from "@/core/domain/segnali";
import { ArrowLeft } from "lucide-react";

// Le soglie che governano ogni segnale, accanto al suo interruttore: [percorso, etichetta].
// Una soglia può servire a più segnali (l'assenza vale anche per il bentornato): la si cambia
// in un punto, e la regola scritta accanto agli altri si aggiorna da sola.
const SOGLIE_DEL_SEGNALE = {
  in_scadenza: [["abbonamentoInScadenzaGiorni", "Giorni prima della fine"]],
  scaduto_recuperabile: [["segnali.recuperabileGiorni", "Recuperabile per giorni"]],
  assente: [["segnali.assenzaGiorni", "Giorni senza ingressi"]],
  in_calo: [["segnali.caloPercentuale", "Sotto la % della media"], ["segnali.mediaMinimaCalo", "Media minima (ingressi in 4 settimane)"]],
  no_show_ripetuti: [["segnali.noShowSegnale", "No-show in 4 settimane"]],
  ambientamento_giorno_7: [["segnali.primoControlloGiorni", "Giorni dall'iscrizione"]],
  ambientamento_pochi_ingressi: [["segnali.ambientamentoGiorni", "Fino a giorni dall'iscrizione"], ["segnali.ingressiAmbientamento", "Ingressi minimi in 4 settimane"]],
  documento_in_scadenza: [["documentoInScadenzaGiorni", "Giorni prima della scadenza"]],
  da_ricontattare: [["lead.sollecitoGiorni", "Giorni di attesa"]],
  ultimo_tentativo: [["lead.ultimoTentativoGiorni", "Giorni di attesa"]],
  conversazioni_ferme: [["lead.fermaGiorni", "Giorni senza novità"]],
  da_recuperare: [["lead.recuperoGiorni", "Giorni da non interessato"]],
  traguardo: [["segnali.ogniTraguardo", "Ogni quanti ingressi"]],
};
// Quelle che non stanno sotto un segnale solo.
const SOGLIE_STATI = [
  ["segnali.nuovoGiorni", "«Nuovo» per quanti giorni dall'inizio dell'abbonamento"],
  ["segnali.archiviazioneGiorni", "Archivia chi è senza abbonamento da quanti giorni (0 = mai)"],
];
const SOGLIE_GENERALI = [
  ["segnali.contattoNascondeGiorni", "Dopo un «Fatto», per quanti giorni la riga non torna"],
  ["lead.tentativiMassimi", "Contatti: tentativi senza risposta prima di arrendersi"],
  ["lead.nonRaggiungibileGiorni", "…e da quanti giorni dall'ultimo, per chiuderlo da solo"],
];

const leggi = (o, percorso) => percorso.split(".").reduce((x, k) => x?.[k], o);
const scrivi = (o, percorso, v) => {
  const chiavi = percorso.split(".");
  const copia = structuredClone(o);
  let x = copia;
  for (const k of chiavi.slice(0, -1)) x = x[k] ??= {};
  x[chiavi.at(-1)] = v;
  return copia;
};

function CampoSoglia({ percorso, etichetta, valori, onCambia }) {
  const id = `soglia-${percorso}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{etichetta}</Label>
      <Input id={id} type="number" inputMode="numeric" min={percorso.endsWith("archiviazioneGiorni") ? 0 : 1} max={3650} className="h-9 w-32"
        value={leggi(valori, percorso) ?? ""} onChange={(e) => onCambia(percorso, e.target.value === "" ? "" : Number(e.target.value))} />
    </div>
  );
}

/**
 * Impostazioni › Da fare: quali segnali la palestra segue, e quando scattano. Ogni segnale ha il
 * suo interruttore, la regola in parole (shared/segnali.js) e le sue soglie accanto; uno spento
 * non si calcola più — né in Da fare, né nel diario, né per i messaggi automatici. Gli stati dei
 * soci restano: "In calo" è vero anche se nessuno segue chi non viene.
 *
 * Le soglie stavano in Comunicazioni, ma decidono molto più dei messaggi. Le cambia
 * l'amministratore; ogni cambio finisce nel registro delle azioni.
 */
export default function ImpostazioniDaFare() {
  const { toast } = useToast();
  const [dati, setDati] = useState(null);
  const [soglie, setSoglie] = useState(null);
  const [spenti, setSpenti] = useState(new Set());
  const [errore, setErrore] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const prendi = (d) => { setDati(d); setSoglie(d.soglie); setSpenti(new Set(d.segnali_spenti)); };
  const carica = useCallback(() => {
    setErrore(null);
    api.impostazioni.daFare().then(prendi).catch(setErrore);
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const cambiaSoglia = (percorso, v) => setSoglie((s) => scrivi(s, percorso, v));
  const accendi = (codice, acceso) => setSpenti((s) => { const n = new Set(s); if (acceso) n.delete(codice); else n.add(codice); return n; });
  // La regola si scrive con le soglie che si stanno scegliendo: si vede subito che cosa cambia.
  const inProva = useMemo(() => soglie && { ...soglie, segnali: { ...soglie.segnali } }, [soglie]);
  const cambiato = dati && (JSON.stringify(soglie) !== JSON.stringify(dati.soglie)
    || [...spenti].sort().join() !== [...dati.segnali_spenti].sort().join());

  const salva = async () => {
    setSalvando(true);
    try {
      prendi(await api.impostazioni.salvaDaFare({ soglie, segnali_spenti: [...spenti] }));
      toast({ title: "Impostazioni salvate", description: "Da fare, gli stati e la dashboard le usano da subito." });
    } catch (err) {
      toast({ title: "Non salvate", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!dati || !soglie) return <LoadingState minHeight="h-64" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <Link to="/da-fare" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Torna a Da fare
      </Link>
      <PageHeader title="Impostazioni di Da fare" description="Quali cose da fare segue la palestra, e quando scattano">
        <Button onClick={salva} disabled={!cambiato || salvando}>{salvando ? "Salvataggio..." : "Salva"}</Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stati dei soci</CardTitle>
          <CardDescription>
            Nuovo, Attivo, In calo, Senza abbonamento, Sospeso, Archiviato. «In calo» usa le soglie di «Chi non viene» qui sotto, anche se quei segnali sono spenti.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {SOGLIE_STATI.map(([p, e]) => <CampoSoglia key={p} percorso={p} etichetta={e} valori={soglie} onCambia={cambiaSoglia} />)}
        </CardContent>
      </Card>

      {LINEE.map((l) => (
        <Card key={l.valore}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{l.etichetta}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {l.segnali.map((codice) => {
              const acceso = !spenti.has(codice);
              return (
                <div key={codice} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start gap-3">
                  <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                    <Checkbox checked={acceso} onCheckedChange={(v) => accendi(codice, v === true)} className="mt-0.5" aria-label={`Segui «${etichettaSegnale(codice)}»`} />
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${acceso ? "" : "text-muted-foreground line-through"}`}>{etichettaSegnale(codice)}</span>
                      <span className="block text-xs text-muted-foreground">Scatta quando {regolaSegnale(codice, inProva)}.</span>
                    </span>
                  </label>
                  {acceso && SOGLIE_DEL_SEGNALE[codice] && (
                    <div className="flex flex-wrap gap-3 sm:justify-end pl-7 sm:pl-0">
                      {SOGLIE_DEL_SEGNALE[codice].map(([p, e]) => <CampoSoglia key={p} percorso={p} etichetta={e} valori={soglie} onCambia={cambiaSoglia} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">In generale</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {SOGLIE_GENERALI.map(([p, e]) => <CampoSoglia key={p} percorso={p} etichetta={e} valori={soglie} onCambia={cambiaSoglia} />)}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={salva} disabled={!cambiato || salvando}>{salvando ? "Salvataggio..." : "Salva"}</Button>
      </div>
    </div>
  );
}
