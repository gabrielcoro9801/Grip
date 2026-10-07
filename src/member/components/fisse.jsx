import React, { createContext, useContext, useState } from "react";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Repeat } from "lucide-react";

/**
 * Le prenotazioni fisse nel portale.
 *
 * La card di una lezione ha "Prenota fisso ogni martedì": invece di passare il gestore attraverso
 * le due viste (categorie e calendario) e i loro elenchi, la pagina lo mette in un contesto e la
 * card lo legge da qui.
 */
export const FisseContext = createContext(null);
export const useFisse = () => useContext(FisseContext);

const GIORNI_INGLESI = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** 'Tuesday' da "2026-10-13". In UTC: è una data, non un istante. */
export const giornoDi = (iso) => {
  const [a, m, g] = String(iso).slice(0, 10).split("-").map(Number);
  return GIORNI_INGLESI[new Date(Date.UTC(a, m - 1, g)).getUTCDay()];
};
const NOMI = { Monday: "lunedì", Tuesday: "martedì", Wednesday: "mercoledì", Thursday: "giovedì", Friday: "venerdì", Saturday: "sabato", Sunday: "domenica" };
const nomeGiorno = (inglese) => NOMI[inglese] ?? inglese;

/** Sotto la card di una lezione di una serie: prenotarla fissa, o il segno che lo è già. */
export function AzioneFissa({ session }) {
  const fisse = useFisse();
  if (!fisse || !session._serie || session._finita) return null;
  if (session._serie.mia_fissa) {
    return (
      <p className="text-xs text-primary flex items-center gap-1">
        <Repeat className="w-3 h-3" aria-hidden="true" /> Prenotazione fissa attiva
      </p>
    );
  }
  const giorno = giornoDi(session.date);
  return (
    <button
      type="button" disabled={fisse.inCorso} onClick={() => fisse.prenotaFisso(session, giorno)}
      className="text-xs font-medium text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
    >
      <Repeat className="w-3 h-3" aria-hidden="true" /> Prenota fisso ogni {nomeGiorno(giorno)}
    </button>
  );
}

/** L'elenco delle proprie fisse, in cima alla pagina Corsi, con "Termina". */
export function LeMieFisse({ fisse, onTermina }) {
  const [chiedi, setChiedi] = useState(null);
  if (!fisse.length) return null;
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2"><Repeat className="w-4 h-4 text-primary" aria-hidden="true" /> Le mie prenotazioni fisse</h2>
          <p className="text-xs text-muted-foreground">Il tuo posto ogni settimana: le lezioni si prenotano da sole finché hai un abbonamento valido.</p>
        </div>
        <ul className="divide-y divide-border">
          {fisse.map((f) => (
            <li key={f.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{f.corso}</p>
                <p className="text-xs text-muted-foreground">
                  Ogni {f.giorni.map(nomeGiorno).join(" e ")} · {f.inizio}–{f.fine}
                </p>
              </div>
              {chiedi === f.id ? (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setChiedi(null)}>No</Button>
                  <Button size="sm" variant="destructive" onClick={() => { setChiedi(null); onTermina(f); }}>Sì, termina</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setChiedi(f.id)}>Termina</Button>
              )}
            </li>
          ))}
        </ul>
        {chiedi && <p className="text-xs text-muted-foreground">Terminando, le prossime lezioni di questa fissa vengono disdette (quelle ancora disdicibili).</p>}
      </CardContent>
    </Card>
  );
}
