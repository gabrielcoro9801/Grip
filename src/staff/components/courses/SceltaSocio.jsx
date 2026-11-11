import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { api } from "@/core/api/client";
import { Input } from "@/ui/primitivi/input";
import Paginazione from "@/ui/Paginazione";
import { LoadingState } from "@/ui/Spinner";
import { formatData } from "@/core/domain/format";
import { cn } from "@/ui/utils";

/**
 * Scegliere un socio, uno alla volta: la ricerca, 15 soci per pagina con data di nascita e
 * codice, e un pulsante a scelta unica per riga (`role="radio"`). I soci li cerca il server
 * (GET /api/soci/cerca, la stessa regola dell'elenco dei soci): prima la finestra della
 * prenotazione si teneva in memoria tutti i soci.
 *
 * Chi è già prenotato si vede, ma non si sceglie: altrimenti il dubbio «c'è o non c'è?» lo
 * scioglieva solo il rifiuto del server.
 *
 * @param scelto      il socio scelto ({ id, nome, cognome, … }) o null
 * @param onScegli    (socio) => void
 * @param giaPrenotati Set degli id dei soci che non si possono scegliere
 */
export default function SceltaSocio({ scelto, onScegli, giaPrenotati = new Set(), etichettaGiaScelti = "Già prenotato" }) {
  const [testo, setTesto] = useState("");
  const [cerca, setCerca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [esito, setEsito] = useState(null); // { soci, totale, per_pagina } | { errore }
  const elenco = useRef(null);

  // Si chiede al server quando si smette di scrivere, non a ogni tasto.
  useEffect(() => {
    const t = setTimeout(() => { setCerca(testo.trim()); setPagina(1); }, 250);
    return () => clearTimeout(t);
  }, [testo]);

  useEffect(() => {
    let vivo = true;
    setEsito((prima) => (prima?.soci ? { ...prima, inCorso: true } : null));
    api.soci.cerca({ q: cerca, pagina })
      .then((r) => { if (vivo) setEsito(r); })
      .catch((err) => { if (vivo) setEsito({ errore: err.message }); });
    return () => { vivo = false; };
  }, [cerca, pagina]);

  const soci = esito?.soci ?? [];
  const sceglibile = (s) => !giaPrenotati.has(s.id);
  // Il pulsante che riceve il tab: lo scelto se è in pagina, altrimenti il primo che si può scegliere.
  const conFuoco = soci.find((s) => s.id === scelto?.id && sceglibile(s))?.id ?? soci.find(sceglibile)?.id;

  // Le frecce si muovono fra i soci sceglibili, come in un gruppo di pulsanti radio.
  const frecce = (e, indice) => {
    const passo = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!passo) return;
    e.preventDefault();
    for (let i = indice + passo; i >= 0 && i < soci.length; i += passo) {
      if (!sceglibile(soci[i])) continue;
      onScegli(soci[i]);
      elenco.current?.querySelectorAll('[role="radio"]')[i]?.focus();
      return;
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search" placeholder="Nome, cognome o codice…" aria-label="Cerca il socio" className="pl-9"
          value={testo} onChange={(e) => setTesto(e.target.value)}
        />
      </div>

      {esito?.errore ? (
        <p role="alert" className="text-sm text-destructive">Ricerca non riuscita: {esito.errore}</p>
      ) : !esito ? (
        <LoadingState minHeight="h-32" label="Ricerca dei soci" />
      ) : soci.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {cerca ? `Nessun socio corrisponde a «${cerca}».` : "Nessun socio da prenotare."}
        </p>
      ) : (
        <div
          ref={elenco} role="radiogroup" aria-label="Soci" aria-busy={esito.inCorso || undefined}
          className={cn("rounded-lg border border-border divide-y divide-border", esito.inCorso && "opacity-60")}
        >
          {soci.map((s, i) => {
            const giaDentro = !sceglibile(s);
            const attivo = scelto?.id === s.id;
            return (
              <button
                key={s.id} type="button" role="radio" aria-checked={attivo} aria-disabled={giaDentro || undefined}
                tabIndex={s.id === conFuoco ? 0 : -1}
                onClick={() => { if (!giaDentro) onScegli(s); }}
                onKeyDown={(e) => frecce(e, i)}
                className={cn(
                  "w-full flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  attivo ? "bg-primary/10" : "hover:bg-muted/40",
                  giaDentro && "cursor-not-allowed text-muted-foreground hover:bg-transparent",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("h-4 w-4 shrink-0 rounded-full border", attivo ? "border-primary border-[5px]" : "border-muted-foreground/50")}
                />
                <span className="flex-1 min-w-[8rem] font-medium">{s.nome} {s.cognome}</span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {s.date_of_birth ? formatData(s.date_of_birth, "breve") : "—"} · {s.codice_socio}
                </span>
                {giaDentro && <span className="w-full pl-7 text-xs">{etichettaGiaScelti}</span>}
              </button>
            );
          })}
        </div>
      )}

      {esito?.soci && (
        <Paginazione pagina={esito.pagina} totale={esito.totale} perPagina={esito.per_pagina} onCambia={setPagina} className="mt-2" />
      )}
    </div>
  );
}
