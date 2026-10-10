import React, { useState, useEffect, useRef } from "react";
import { caricaConsensi, scegliConsenso } from "@/core/api/portale";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { TIPI_CONSENSO } from "@/core/domain/consensi";

// Quanto resta il pulsante "Annulla" dopo aver tolto un consenso.
const SECONDI_PER_ANNULLARE = 8;
const CHIAVE_NON_ORA = "grip.consensi.nonOra";
const nonOraDetto = () => { try { return localStorage.getItem(CHIAVE_NON_ORA) === "1"; } catch { return false; } };

/**
 * Che cosa la palestra può mandare oltre alle comunicazioni di servizio (scadenze, lezioni
 * annullate): promozioni, auguri, proposte. Li sceglie il socio, canale per canale, e può
 * cambiare idea quando vuole: la legge vuole che togliere un consenso sia facile quanto darlo, e
 * dallo stesso posto (GDPR art. 7.3; EDPB, linee guida 05/2020). Per questo togliere è un tocco,
 * con "Annulla" per qualche secondo contro lo sbaglio, invece di una conferma in più.
 *
 * Con `primaVolta` è la domanda in home a chi non ha mai scelto: le caselle partono vuote (un
 * consenso non si presume), si salva anche il "no", e "Non ora" la nasconde su questo dispositivo.
 */
export default function ConsensiComunicazioni({ primaVolta = false }) {
  const [consensi, setConsensi] = useState(null);
  const [errore, setErrore] = useState(null);
  const [tolto, setTolto] = useState(null); // { tipo, etichetta }
  const [scelte, setScelte] = useState({});
  const [nascosto, setNascosto] = useState(primaVolta && nonOraDetto());
  const timer = useRef(null);

  useEffect(() => {
    if (nascosto) return;
    caricaConsensi().then((r) => setConsensi(r.consensi)).catch(setErrore);
  }, [nascosto]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const scegli = async (tipo, valore) => {
    setErrore(null);
    try {
      setConsensi((await scegliConsenso(tipo, valore)).consensi);
      clearTimeout(timer.current);
      if (!valore) {
        setTolto({ tipo, etichetta: TIPI_CONSENSO.find((t) => t.valore === tipo)?.etichetta });
        timer.current = setTimeout(() => setTolto(null), SECONDI_PER_ANNULLARE * 1000);
      } else setTolto(null);
    } catch (err) {
      setErrore(err);
    }
  };

  const salvaPrimaVolta = async () => {
    setErrore(null);
    try {
      let ultimo = null;
      for (const t of TIPI_CONSENSO) ultimo = await scegliConsenso(t.valore, scelte[t.valore] === true);
      setConsensi(ultimo.consensi);
    } catch (err) {
      setErrore(err);
    }
  };
  const nonOra = () => { try { localStorage.setItem(CHIAVE_NON_ORA, "1"); } catch { /* resta per questa visita */ } setNascosto(true); };

  if (nascosto || (!consensi && !errore)) return null;
  // In home si chiede solo a chi non ha mai scelto niente.
  if (primaVolta && consensi && TIPI_CONSENSO.some((t) => consensi[t.valore].il)) return null;

  return (
    <Card className={`border-0 shadow-sm ${primaVolta ? "bg-primary/5" : ""}`}>
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium">{primaVolta ? "Vuoi ricevere anche promozioni e novità?" : "Comunicazioni dalla palestra"}</h2>
          <p className="text-xs text-muted-foreground">
            Scadenze e avvisi sulle lezioni ti arrivano comunque. {primaVolta ? "Scegli tu, canale per canale: puoi cambiare idea quando vuoi dal profilo." : "Qui scegli se ricevere anche promozioni e novità."}
          </p>
        </div>
        {errore && <p className="text-sm text-destructive">{errore.message}</p>}
        {consensi && TIPI_CONSENSO.map((t) => (
          <label key={t.valore} className="flex items-center gap-3 text-sm">
            {primaVolta ? (
              <Checkbox checked={scelte[t.valore] === true} onCheckedChange={(v) => setScelte((s) => ({ ...s, [t.valore]: v === true }))} />
            ) : (
              <Checkbox checked={consensi[t.valore].valore} onCheckedChange={(v) => scegli(t.valore, v === true)} />
            )}
            {t.etichetta}
          </label>
        ))}
        {tolto && (
          <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Tolto: {tolto.etichetta}.</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => scegli(tolto.tipo, true)}>Annulla</Button>
          </div>
        )}
        {primaVolta && consensi && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={nonOra}>Non ora</Button>
            <Button size="sm" onClick={salvaPrimaVolta}>Salva le mie scelte</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
