import React, { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Badge } from "@/ui/primitivi/badge";
import { EmptyState } from "@/ui/StateViews";
import { Search, Check, Dumbbell } from "lucide-react";
import { gruppiPerZona, etichettaGruppo } from "@/core/domain/gruppiMuscolari";
import { cn } from "@/ui/utils";

/**
 * La finestra da cui si pescano gli esercizi per una scheda.
 *
 * Si scelgono a più a più e si aggiungono in una volta sola: comporre una scheda significa
 * quasi sempre mettere dentro cinque o sei esercizi di seguito, e riaprire la stessa
 * finestra sei volte è il modo più veloce per farla odiare.
 *
 * I filtri per gruppo muscolare mostrano solo i gruppi che hanno davvero un esercizio a
 * catalogo: un elenco di venti gruppi di cui quindici vuoti fa sembrare rotto il filtro.
 */
export default function SelettoreEsercizi({ aperto, onChiudi, esercizi, onAggiungi }) {
  const [ricerca, setRicerca] = useState("");
  const [gruppoScelto, setGruppoScelto] = useState(null);
  const [scelti, setScelti] = useState([]);

  // Ogni apertura riparte pulita: trovarsi i filtri della volta prima, e magari zero
  // risultati, sembra un catalogo vuoto.
  useEffect(() => {
    if (aperto) {
      setRicerca("");
      setGruppoScelto(null);
      setScelti([]);
    }
  }, [aperto]);

  const gruppiDisponibili = useMemo(() => {
    const presenti = new Set(esercizi.map((e) => e.muscle_group));
    return gruppiPerZona()
      .map((zona) => ({ ...zona, gruppi: zona.gruppi.filter((g) => presenti.has(g.codice)) }))
      .filter((zona) => zona.gruppi.length > 0);
  }, [esercizi]);

  const visibili = useMemo(() => {
    const cercato = ricerca.trim().toLowerCase();
    return esercizi.filter((e) => {
      if (gruppoScelto && e.muscle_group !== gruppoScelto) return false;
      if (!cercato) return true;
      return `${e.name} ${e.description ?? ""}`.toLowerCase().includes(cercato);
    });
  }, [esercizi, ricerca, gruppoScelto]);

  const commuta = (esercizio) => {
    setScelti((precedenti) =>
      precedenti.some((e) => e.id === esercizio.id)
        ? precedenti.filter((e) => e.id !== esercizio.id)
        : [...precedenti, esercizio]
    );
  };

  const conferma = () => {
    if (scelti.length) onAggiungi(scelti);
    onChiudi();
  };

  return (
    <Dialog open={aperto} onOpenChange={(v) => !v && onChiudi()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Aggiungi esercizi</DialogTitle>
          <DialogDescription>
            Scegline quanti vuoi: entrano nella scheda con una serie ciascuno, poi si
            completano riga per riga.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9" autoFocus
            placeholder="Cerca un esercizio"
            value={ricerca}
            onChange={(e) => setRicerca(e.target.value)}
            aria-label="Cerca un esercizio"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setGruppoScelto(null)}
            aria-pressed={gruppoScelto === null}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
              gruppoScelto === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            Tutti
          </button>
          {gruppiDisponibili.map((zona) =>
            zona.gruppi.map((g) => (
              <button
                key={g.codice}
                type="button"
                onClick={() => setGruppoScelto(gruppoScelto === g.codice ? null : g.codice)}
                aria-pressed={gruppoScelto === g.codice}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  gruppoScelto === g.codice
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                {g.etichetta}
              </button>
            ))
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {visibili.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title={esercizi.length === 0 ? "Il catalogo è vuoto" : "Nessun esercizio corrisponde"}
              description={
                esercizi.length === 0
                  ? "Aggiungi qualche esercizio dalla scheda «Esercizi» prima di comporre una scheda."
                  : "Prova a cambiare la ricerca o il gruppo."
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {visibili.map((esercizio) => {
                const scelto = scelti.some((e) => e.id === esercizio.id);
                return (
                  <li key={esercizio.id}>
                    <button
                      type="button"
                      onClick={() => commuta(esercizio)}
                      aria-pressed={scelto}
                      className={cn(
                        "w-full text-left p-2.5 rounded-lg border transition-colors flex items-start gap-2.5",
                        scelto ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0",
                          scelto ? "bg-primary border-primary" : "border-muted-foreground/40"
                        )}
                      >
                        {scelto && <Check className="w-3 h-3 text-primary-foreground" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{esercizio.name}</span>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {etichettaGruppo(esercizio.muscle_group)}
                          </Badge>
                        </span>
                        {esercizio.description && (
                          <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {esercizio.description}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {scelti.length === 0
              ? "Nessun esercizio scelto"
              : `${scelti.length} ${scelti.length === 1 ? "esercizio scelto" : "esercizi scelti"}`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onChiudi}>Annulla</Button>
            <Button type="button" onClick={conferma} disabled={scelti.length === 0}>
              Aggiungi alla scheda
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
