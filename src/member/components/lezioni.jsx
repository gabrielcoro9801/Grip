import React, { useState } from "react";
import { disdiciPrenotazione } from "@/core/api/portale";
import StatusBadge from "@/ui/StatusBadge";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { giornoLezione, formatData } from "@/core/domain/format";

// I pezzi di una lezione prenotata che Home e Le mie lezioni dicono allo stesso modo.

export const ora = (t) => String(t ?? "").slice(0, 5);

/** «Confermata» o «In lista · 2°»: la pillola dello stato della mia prenotazione. */
export function PillolaStato({ prenotazione }) {
  if (!prenotazione) return null;
  if (prenotazione.stato === "waitlisted") {
    return <StatusBadge status="waitlisted" label={prenotazione.posizione_attesa ? `In lista · ${prenotazione.posizione_attesa}°` : undefined} />;
  }
  return <StatusBadge status={prenotazione.stato} />;
}

/** «Puoi disdire fino a domani alle 14:30», o il perché non si può più. */
export function TermineDisdetta({ lezione, className = "" }) {
  if (lezione.motivo_disdetta_chiusa) return <p className={`text-xs text-muted-foreground ${className}`}>{lezione.motivo_disdetta_chiusa}</p>;
  if (!lezione.disdetta_fino_a) return null;
  const [data, alle] = lezione.disdetta_fino_a.split("T");
  const giorno = giornoLezione(data);
  const quando = /^(Oggi|Domani), /.test(giorno) ? giorno.split(",")[0].toLowerCase() : `${formatData(data, "giorno")}`;
  return <p className={`text-xs text-muted-foreground ${className}`}>Puoi disdire fino a {quando} alle {alle}</p>;
}

/**
 * Disdire con una domanda prima: il posto, una volta lasciato, può prenderlo un altro. Restituisce
 * [disdici(lezione), dialogo, inCorso]; `onFatto` ricarica la pagina.
 */
export function useDisdici(onFatto) {
  const [conferma, dialogo] = useConfirm();
  const { toast } = useToast();
  const [inCorso, setInCorso] = useState(false);
  const disdici = async (lezione) => {
    const inLista = lezione.mia_prenotazione?.stato === "waitlisted";
    const ok = await conferma({
      title: inLista ? "Esci dalla lista d'attesa?" : "Disdici la lezione?",
      description: `${lezione.corso?.nome ?? "Lezione"}, ${giornoLezione(lezione.data)} alle ${ora(lezione.inizio)}.${inLista ? "" : " Il posto torna libero per gli altri."}`,
      confirmLabel: inLista ? "Esci dalla lista" : "Disdici",
      cancelLabel: "Indietro",
      destructive: true,
    });
    if (!ok) return;
    setInCorso(true);
    try {
      await disdiciPrenotazione(lezione.mia_prenotazione.id);
      toast({ title: inLista ? "Non sei più in lista d'attesa" : "Lezione disdetta" });
      onFatto?.();
    } catch (err) {
      toast({ title: "Non disdetta", description: err.message, variant: "destructive" });
    } finally {
      setInCorso(false);
    }
  };
  return [disdici, dialogo, inCorso];
}

/** Una lezione in una riga: corso, giorno e ora, sala; la pillola a destra. */
export function RigaLezione({ lezione, children }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{lezione.corso?.nome ?? "Lezione"}</p>
        <p className="text-xs text-muted-foreground">
          {giornoLezione(lezione.data)} · {ora(lezione.inizio)}{lezione.sala ? ` · ${lezione.sala.nome}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PillolaStato prenotazione={lezione.mia_prenotazione} />
        {children}
      </div>
    </li>
  );
}
