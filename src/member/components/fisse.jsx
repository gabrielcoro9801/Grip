import React, { useEffect, useState } from "react";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import StatusBadge from "@/ui/StatusBadge";
import { useToast } from "@/ui/primitivi/use-toast";
import { Repeat } from "lucide-react";
import { cn } from "@/ui/utils";
import { formatData, giornoLezione } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";
import { anteprimaFissa, prenotaFisso, cambiaFissa } from "@/core/api/portale";
import { Foglio } from "@/member/components/lezioni";

// Le prenotazioni fisse nel portale (docs/piani/portale.md, D-4): con le date. Il socio sceglie
// fino a quando — una data o un numero di lezioni — dentro il massimo, e prima di confermare vede
// che cosa succederà a ogni lezione (l'anteprima è la stessa regola che poi prenota).

const NOMI = { Monday: "lunedì", Tuesday: "martedì", Wednesday: "mercoledì", Thursday: "giovedì", Friday: "venerdì", Saturday: "sabato", Sunday: "domenica" };
export const nomeGiorno = (inglese) => NOMI[inglese] ?? inglese;

const ESITI = {
  confermata: ["Prenotata", "positivo"],
  in_attesa: ["In lista d'attesa", "attesa"],
  gia_prenotata: ["Già prenotata", "neutro"],
  gia_in_attesa: ["Già in lista", "neutro"],
  sospesa: ["Sospesa", "neutro"],
  disdetta: ["Disdetta da te", "neutro"],
  piena: ["Piena", "negativo"],
  scoperta: ["Senza abbonamento", "negativo"],
};

const quante = (n, una, tante) => `${n} ${n === 1 ? una : tante}`;

/** Perché il massimo è quello: l'abbonamento o la fine della sessione. */
function Massimo({ a }) {
  if (!a?.massimo) return null;
  const fino = a.ultima_coperta ?? a.massimo;
  const perAbbonamento = a.copertura_fino_al && a.copertura_fino_al < a.ultima_lezione;
  return (
    <p className="text-xs text-muted-foreground">
      Al massimo fino al {formatData(fino, "giornoMeseLungo")}:{" "}
      {perAbbonamento
        ? `l'ultima lezione coperta dal tuo abbonamento (scade il ${formatData(a.copertura_fino_al, "giornoMeseLungo")}).`
        : "l'ultima lezione della sessione."}
    </p>
  );
}

/**
 * Il foglio della fissa: per crearne una (`sessione`) o per allungarla e accorciarla (`fissa`).
 * @param sessione { id, corso, giorno, inizio }
 * @param fissa    { id, al } se si cambia
 * @param alIniziale la data con cui aprirlo («Allunga»: il nuovo massimo)
 */
export function FoglioFissa({ sessione, fissa = null, alIniziale = null, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [modo, setModo] = useState("data");
  const [al, setAl] = useState(alIniziale ?? fissa?.al ?? "");
  const [numero, setNumero] = useState("");
  const [anteprima, setAnteprima] = useState(null);
  const [errore, setErrore] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  // L'anteprima si richiede a ogni cambio, poco dopo l'ultimo tasto. La prima volta, senza data,
  // il server risponde fino al massimo: è la data proposta.
  useEffect(() => {
    let attivo = true;
    const chiedi = modo === "data" ? { al: al || null } : { numero: numero || null };
    if (modo === "numero" && !numero) { setAnteprima(null); return undefined; }
    const t = setTimeout(() => {
      anteprimaFissa(sessione.id, { ...chiedi, fissa: fissa?.id })
        .then((a) => {
          if (!attivo) return;
          setAnteprima(a);
          setErrore(null);
          if (!al && modo === "data") setAl(a.al);
        })
        .catch((err) => { if (attivo) { setErrore(err.message); setAnteprima(null); } });
    }, 300);
    return () => { attivo = false; clearTimeout(t); };
  }, [sessione.id, fissa?.id, modo, al, numero]);

  const conferma = async () => {
    setInCorso(true);
    const scelta = modo === "data" ? { al } : { numero: Number(numero) };
    try {
      if (fissa) {
        const esito = await cambiaFissa(fissa.id, scelta);
        const parti = [];
        if (esito.prenotate || esito.in_attesa) parti.push(quante(esito.prenotate + esito.in_attesa, "lezione prenotata", "lezioni prenotate"));
        if (esito.disdette) parti.push(quante(esito.disdette, "disdetta", "disdette"));
        if (esito.rimaste) parti.push(`${quante(esito.rimaste, "resta", "restano")} perché oltre il termine di disdetta`);
        toast({ title: `Fissa fino al ${formatData(esito.fissa.al, "giornoMeseLungo")}`, description: parti.join(", ") || undefined });
      } else {
        const esito = await prenotaFisso(sessione.id, scelta);
        const parti = [quante(esito.prenotate, "lezione prenotata", "lezioni prenotate")];
        if (esito.in_attesa) parti.push(`${esito.in_attesa} in lista d'attesa`);
        toast({ title: `Prenotazione fissa: ${sessione.corso}`, description: parti.join(", ") });
      }
      onFatto?.();
      onChiudi();
    } catch (err) {
      toast({ title: "Non salvata", description: err.message, variant: "destructive" });
    } finally {
      setInCorso(false);
    }
  };

  const giorno = nomeGiorno(sessione.giorno);
  const verbo = !fissa ? `Prenota ogni ${giorno}` : anteprima && fissa.al && anteprima.al > fissa.al ? "Allunga" : anteprima && fissa.al && anteprima.al < fissa.al ? "Accorcia" : "Salva";
  const lezioni = anteprima?.lezioni ?? [];

  return (
    <Foglio aperto onChiudi={onChiudi} titolo={`${sessione.corso} · ogni ${giorno} ${sessione.inizio}`} descrizione={fissa ? `Ora fino al ${formatData(fissa.al, "giornoMeseLungo")}` : "Il tuo posto ogni settimana, fino a quando scegli tu."}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Fino a quando">
          {[["data", "Fino al"], ["numero", "Per N lezioni"]].map(([v, etichetta]) => (
            <button
              key={v} type="button" aria-pressed={modo === v} onClick={() => setModo(v)}
              className={cn("min-h-11 rounded-md text-sm font-medium", modo === v ? "bg-background shadow-sm" : "text-muted-foreground")}
            >{etichetta}</button>
          ))}
        </div>
        {modo === "data" ? (
          <div className="space-y-1">
            <Label htmlFor="fissa-al">Fino al</Label>
            <Input id="fissa-al" type="date" className="min-h-11" min={oggiIso()} max={anteprima?.massimo ?? undefined} value={al} onChange={(e) => setAl(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="fissa-numero">Quante lezioni</Label>
            <Input id="fissa-numero" type="number" inputMode="numeric" min="1" className="min-h-11" value={numero} onChange={(e) => setNumero(e.target.value)} />
          </div>
        )}
        <Massimo a={anteprima} />
        {errore && <p className="text-sm text-destructive" role="alert">{errore}</p>}

        {anteprima && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {quante(lezioni.length, "lezione", "lezioni")}
              {anteprima.al && ` fino al ${formatData(anteprima.al, "giornoMeseLungo")}`}
              {anteprima.in_attesa > 0 && ` · ${anteprima.in_attesa} in lista d'attesa`}
            </p>
            {fissa && fissa.al && anteprima.al < fissa.al && (
              <p className="text-xs text-muted-foreground">Le lezioni dopo il {formatData(anteprima.al, "giornoMeseLungo")} si disdicono (quelle ancora disdicibili).</p>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border max-h-60 overflow-y-auto">
              {lezioni.map((l) => {
                const [etichetta, tono] = ESITI[l.esito] ?? [l.esito, "neutro"];
                return (
                  <li key={l.data} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{giornoLezione(l.data)}</span>
                    <StatusBadge label={etichetta} tone={tono} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Button className="w-full min-h-11" disabled={inCorso || !anteprima || !lezioni.length} onClick={conferma}>{verbo}</Button>
      </div>
    </Foglio>
  );
}

/**
 * L'elenco delle proprie fisse: fino a quando, quante lezioni hanno prenotato, «Allunga» quando
 * il massimo è più in là della fine, «Cambia» e «Termina».
 * @param prenotate { [serie_id]: quante lezioni future ha prenotato quella fissa }
 */
export function LeMieFisse({ fisse, prenotate = {}, onTermina, onCambia }) {
  const [chiedi, setChiedi] = useState(null);
  if (!fisse.length) return null;
  return (
    <section aria-labelledby="titolo-fisse" className="space-y-1">
      <h2 id="titolo-fisse" className="text-sm font-semibold flex items-center gap-2"><Repeat className="w-4 h-4 text-primary" aria-hidden="true" /> Prenotazioni fisse</h2>
      <Card className="border-0 shadow-sm">
        <CardContent className="px-4 py-1">
          <ul className="divide-y divide-border">
            {fisse.map((f) => {
              const n = prenotate[f.serie_id] ?? 0;
              const allungabile = f.massimo && f.al && f.massimo > f.al;
              return (
                <li key={f.id} className="py-3 space-y-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.corso} · ogni {f.giorni.map(nomeGiorno).join(" e ")} {f.inizio}</p>
                    <p className="text-xs text-muted-foreground">
                      Fino al {formatData(f.al, "lungo")} · {quante(n, "lezione prenotata", "lezioni prenotate")}
                    </p>
                    {allungabile && <p className="text-xs text-primary">Può arrivare fino al {formatData(f.massimo, "lungo")}.</p>}
                  </div>
                  {chiedi === f.id ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Terminando, le prossime lezioni di questa fissa si disdicono (quelle ancora disdicibili).</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 min-h-11" onClick={() => setChiedi(null)}>No</Button>
                        <Button size="sm" variant="destructive" className="flex-1 min-h-11" onClick={() => { setChiedi(null); onTermina(f); }}>Sì, termina</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {allungabile
                        ? <Button size="sm" className="flex-1 min-h-11" onClick={() => onCambia(f, f.massimo)}>Allunga</Button>
                        : <Button size="sm" variant="outline" className="flex-1 min-h-11" onClick={() => onCambia(f)}>Cambia</Button>}
                      <Button size="sm" variant="ghost" className="flex-1 min-h-11" onClick={() => setChiedi(f.id)}>Termina</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
