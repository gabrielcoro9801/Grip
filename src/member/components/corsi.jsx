import React, { useState } from "react";
import { Button } from "@/ui/primitivi/button";
import StatusBadge from "@/ui/StatusBadge";
import { Plus, Check, MapPin, User } from "lucide-react";
import { cn } from "@/ui/utils";
import { formatData, quandoIstante } from "@/core/domain/format";
import {
  Foglio, FoglioListaAttesa, PillolaStato, TermineDisdetta, AggiungiAlCalendario,
  usePrenota, useDisdici, nomeLezione, ora, viva,
} from "@/member/components/lezioni";

// Le lezioni nella pagina Corsi (docs/piani/portale.md, D-3): la card con la pillola dei posti e
// il pulsante tondo, e quello che succede al tocco.

export const GIORNI = {
  Monday: ["lunedì", "lun"], Tuesday: ["martedì", "mar"], Wednesday: ["mercoledì", "mer"], Thursday: ["giovedì", "gio"],
  Friday: ["venerdì", "ven"], Saturday: ["sabato", "sab"], Sunday: ["domenica", "dom"],
};

/** «8 posti», «Ultimi 3 posti», «Piena · 5 in attesa», «Piena · lista chiusa». */
export function PillolaPosti({ lezione }) {
  const { liberi, in_attesa: attesa } = lezione.posti;
  if (liberi === 0) {
    return <StatusBadge tone="negativo" label={lezione.lista_chiusa ? "Piena · lista chiusa" : attesa ? `Piena · ${attesa} in attesa` : "Piena"} />;
  }
  if (liberi <= 3) return <StatusBadge tone="attesa" label={liberi === 1 ? "Ultimo posto" : `Ultimi ${liberi} posti`} />;
  return <StatusBadge tone="neutro" label={`${liberi} posti`} />;
}

/**
 * Il tocco su una lezione, deciso in un posto solo: la mia (viva) apre il suo foglio; un posto
 * offerto si conferma; una piena apre il foglio della lista d'attesa; il resto si prenota subito.
 * Restituisce { tocca(lezione), fogli, inCorso }: `fogli` va messo nella pagina.
 */
export function useTocco(onFatto, palestra) {
  const [prenota, prenotando] = usePrenota(onFatto);
  const [disdici, dialogoDisdici, disdicendo] = useDisdici(() => { setMia(null); onFatto?.(); });
  const [mia, setMia] = useState(null);
  const [piena, setPiena] = useState(null);
  const inCorso = prenotando || disdicendo;

  const tocca = (l) => {
    const p = l.mia_prenotazione;
    if (viva(p) && p.posto_offerto_fino_a) return prenota(l);
    if (viva(p)) return setMia(l);
    if (l.posti.al_completo) return setPiena(l);
    return prenota(l);
  };

  const fogli = (
    <>
      <FoglioListaAttesa
        lezione={piena} inCorso={inCorso} onChiudi={() => setPiena(null)}
        onEntra={async () => { const l = piena; setPiena(null); await prenota(l); }}
      />
      {mia && (
        <Foglio aperto onChiudi={() => setMia(null)} titolo={nomeLezione(mia)}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <PillolaStato lezione={mia} />
              <span>{ora(mia.inizio)}–{ora(mia.fine)}</span>
              {mia.sala && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{mia.sala.nome}</span>}
              {mia.istruttore && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" aria-hidden="true" />{mia.istruttore.nome}</span>}
            </div>
            {mia.mia_prenotazione.posto_offerto_fino_a && (
              <p className="text-sm">Si è liberato un posto: è tuo se lo confermi entro {quandoIstante(mia.mia_prenotazione.posto_offerto_fino_a)}.</p>
            )}
            <TermineDisdetta lezione={mia} />
            <div className="flex flex-col gap-2">
              {mia.mia_prenotazione.posto_offerto_fino_a && (
                <Button className="min-h-11" disabled={inCorso} onClick={() => { const l = mia; setMia(null); prenota(l); }}>Conferma il posto</Button>
              )}
              <AggiungiAlCalendario lezione={mia} palestra={palestra} />
              {!mia.motivo_disdetta_chiusa && (
                <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" disabled={inCorso} onClick={() => disdici(mia)}>
                  {mia.mia_prenotazione.stato === "waitlisted" ? "Esci dalla lista" : "Disdici"}
                </Button>
              )}
            </div>
          </div>
        </Foglio>
      )}
      {dialogoDisdici}
    </>
  );
  return { tocca, fogli, inCorso };
}

/**
 * Il pulsante tondo a destra di una lezione: + prenota, ✓ già mia (apre il foglio), «Conferma» per
 * un posto offerto; se non si può prenotare, il perché al suo posto.
 */
export function PulsanteLezione({ lezione, onTocca, inCorso }) {
  const p = lezione.mia_prenotazione;
  const nome = nomeLezione(lezione);
  if (viva(p) && p.posto_offerto_fino_a) {
    return <Button size="sm" className="min-h-11 shrink-0" disabled={inCorso} onClick={() => onTocca(lezione)}>Conferma</Button>;
  }
  if (viva(p)) {
    return (
      <button
        type="button" onClick={() => onTocca(lezione)} aria-label={`${nome}: già prenotata, apri`}
        className={cn("w-11 h-11 shrink-0 rounded-full flex items-center justify-center", p.stato === "waitlisted" ? "bg-warning/15 text-warning" : "bg-success/15 text-success")}
      >
        <Check className="w-5 h-5" aria-hidden="true" />
      </button>
    );
  }
  if (lezione.motivo_non_prenotabile) {
    return <p className="text-xs text-muted-foreground text-right max-w-[9rem] shrink-0">{lezione.motivo_non_prenotabile}</p>;
  }
  return (
    <button
      type="button" disabled={inCorso} onClick={() => onTocca(lezione)}
      aria-label={lezione.posti.al_completo ? `${nome}: piena, entra in lista d'attesa` : `Prenota ${nome}`}
      className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-50"
    >
      <Plus className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}

/** La card di una lezione: orario, corso, istruttore · sala, posti; il bordo del colore della categoria. */
export function CardLezione({ lezione, onTocca, inCorso, conGiorno = false }) {
  return (
    <li
      className="flex items-center gap-3 rounded-lg bg-card shadow-sm border-l-4 px-3 py-3"
      style={{ borderLeftColor: lezione.categoria?.colore ?? "hsl(var(--border))" }}
    >
      <div className={cn("shrink-0 text-sm font-semibold tabular-nums", conGiorno ? "w-16" : "w-12")}>
        {conGiorno && <span className="block text-xs font-normal text-muted-foreground">{formatData(lezione.data, "giorno")}</span>}
        {ora(lezione.inizio)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{lezione.corso?.nome ?? "Lezione"}</p>
        <p className="text-xs text-muted-foreground truncate">{[lezione.istruttore?.nome, lezione.sala?.nome].filter(Boolean).join(" · ")}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {viva(lezione.mia_prenotazione) ? <PillolaStato lezione={lezione} /> : <PillolaPosti lezione={lezione} />}
        </div>
      </div>
      <PulsanteLezione lezione={lezione} onTocca={onTocca} inCorso={inCorso} />
    </li>
  );
}
