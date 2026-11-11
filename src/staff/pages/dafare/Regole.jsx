import React, { useCallback, useEffect, useState } from "react";
import { Navigate, useOutletContext } from "react-router-dom";
import { api } from "@/core/api/client";
import PageHeader from "@/staff/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { SCHEDE, regolaAvviso } from "@/staff/components/dafare/avvisi";
import { sogliaValida } from "@/core/domain/soglie";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";

// I campi di ogni avviso: [percorso nelle soglie, etichetta]. E la nota, quando una soglia vale
// anche fuori da Da fare.
const CAMPI = {
  in_scadenza: {
    campi: [["abbonamentoInScadenzaGiorni", "Avvisa quanti giorni prima della scadenza"]],
    nota: "Vale anche per il portale, il bancone e l'Elenco soci.",
  },
  scaduto: {
    campi: [["scadutoGiorni", "Chiudi l'avviso quanti giorni dopo la scadenza"]],
  },
  frequenza: {
    campi: [
      ["segnali.assenzaGiorni", "Giorni senza ingressi"],
      ["segnali.caloPercentuale", "Sotto la % della media"],
      ["segnali.mediaMinimaCalo", "Media minima, ingressi in 4 settimane"],
      ["frequenzaRiapriGiorni", "Ricompare dopo quanti giorni"],
    ],
    nota: "Le stesse soglie decidono lo stato «In calo» dei soci.",
  },
  documento: {
    campi: [["documentoInScadenzaGiorni", "Avvisa quanti giorni prima della scadenza"]],
    nota: "Vale anche per il portale del socio.",
  },
  compleanno: {
    campi: [["compleannoPrimaGiorni", "Avvisa quanti giorni prima"], ["compleannoDopoGiorni", "Chiudi quanti giorni dopo"]],
    nota: "0 vuol dire il giorno stesso.",
  },
};

const leggi = (o, percorso) => percorso.split(".").reduce((x, k) => x?.[k], o);
const scrivi = (o, percorso, v) => {
  const chiavi = percorso.split(".");
  const copia = structuredClone(o);
  let x = copia;
  for (const k of chiavi.slice(0, -1)) x = x[k] ??= {};
  x[chiavi.at(-1)] = v;
  return copia;
};
const chiaveDi = (percorso) => percorso.split(".").at(-1);

function CampoSoglia({ percorso, etichetta, valori, onCambia }) {
  const id = `regola-${percorso}`;
  const valore = leggi(valori, percorso);
  const sbagliato = !sogliaValida(valore, chiaveDi(percorso));
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{etichetta}</Label>
      <Input
        id={id} type="number" inputMode="numeric" className="h-9 w-32" aria-invalid={sbagliato || undefined}
        min={chiaveDi(percorso).startsWith("compleanno") ? 0 : 1} max={chiaveDi(percorso) === "caloPercentuale" ? 100 : 3650}
        value={valore ?? ""} onChange={(e) => onCambia(percorso, e.target.value === "" ? "" : Number(e.target.value))}
      />
    </div>
  );
}

/**
 * Le Regole di Da fare: per ognuno dei cinque avvisi se la palestra lo segue, quando compare e
 * quando se ne va. La regola in parole si riscrive mentre si cambiano i numeri. Le cambia solo
 * l'amministratore (P7); ogni cambio finisce nel registro delle azioni.
 *
 * «Segui» accende o spegne tutti i segnali dell'avviso (TIPI_AVVISO, `segnali`): uno spento non
 * compare in Da fare né si conta. Gli altri segnali spenti (quelli del bancone) restano come
 * sono, e così le soglie che non stanno qui (stati dei soci, Lead): si salvano con il valore che
 * hanno.
 *
 * Sotto i 640 px «Salva» è una barra fissa in basso: le regole sono lunghe e il pulsante in cima
 * non si vede più.
 */
export default function Regole() {
  const { staffUser } = useStaffAuth();
  const { ricaricaConteggi } = useOutletContext() ?? {};
  const { toast } = useToast();
  const [dati, setDati] = useState(null);
  const [soglie, setSoglie] = useState(null);
  const [spenti, setSpenti] = useState([]);
  const [errore, setErrore] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const amministratore = canEdit(staffUser?.ruolo, "admin_users");

  const prendi = (d) => { setDati(d); setSoglie(d.soglie); setSpenti(d.segnali_spenti ?? []); };
  const carica = useCallback(() => {
    setErrore(null);
    api.impostazioni.daFare().then(prendi).catch(setErrore);
  }, []);
  useEffect(() => { if (amministratore) carica(); }, [amministratore, carica]);

  if (!amministratore) return <Navigate to="/da-fare" replace />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!dati || !soglie) return <LoadingState minHeight="h-64" />;

  const cambiaSoglia = (percorso, v) => setSoglie((s) => scrivi(s, percorso, v));
  const segui = (scheda, acceso) => setSpenti((s) => (acceso
    ? s.filter((c) => !scheda.segnali.includes(c))
    : [...new Set([...s, ...scheda.segnali])]));
  const seguito = (scheda) => !scheda.segnali.every((c) => spenti.includes(c));

  const cambiato = JSON.stringify(soglie) !== JSON.stringify(dati.soglie)
    || [...spenti].sort().join() !== [...(dati.segnali_spenti ?? [])].sort().join();
  const sbagliati = SCHEDE.some((s) => CAMPI[s.tipo].campi.some(([p]) => !sogliaValida(leggi(soglie, p), chiaveDi(p))));

  const salva = async () => {
    setSalvando(true);
    try {
      prendi(await api.impostazioni.salvaDaFare({ soglie, segnali_spenti: spenti }));
      toast({ title: "Regole salvate", description: "Da fare, gli stati dei soci e la dashboard le usano da subito." });
      ricaricaConteggi?.();
    } catch (err) {
      toast({ title: "Regole non salvate", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  return (
    <div className="pb-20 sm:pb-0">
      <PageHeader title="Regole" description="Quali avvisi segue la palestra, quando compaiono e quando se ne vanno." />

      <div className="grid gap-4 lg:grid-cols-2">
        {SCHEDE.map((s) => {
          const acceso = seguito(s);
          const { campi, nota } = CAMPI[s.tipo];
          return (
            <Card key={s.tipo} className="border-0 shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className={`text-base ${acceso ? "" : "text-muted-foreground"}`}>{s.titolo}</CardTitle>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={acceso} onCheckedChange={(v) => segui(s, v === true)} aria-label={`Segui «${s.titolo}»`} />
                  Segui
                </label>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className={`text-sm ${acceso ? "" : "text-muted-foreground line-through"}`}>{regolaAvviso(s.tipo, soglie)}</p>
                {acceso && (
                  <div className="flex flex-wrap gap-3">
                    {campi.map(([p, e]) => <CampoSoglia key={p} percorso={p} etichetta={e} valori={soglie} onCambia={cambiaSoglia} />)}
                  </div>
                )}
                {acceso && nota && <p className="text-xs text-muted-foreground">{nota}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card p-3 sm:static sm:z-auto sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 flex justify-end">
        <Button className="w-full sm:w-auto" onClick={salva} disabled={!cambiato || sbagliati || salvando}>
          {salvando ? "Salvataggio..." : "Salva"}
        </Button>
      </div>
    </div>
  );
}
