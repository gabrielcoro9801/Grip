import React, { useState } from "react";
import { disdiciPrenotazione, prenotaLezione } from "@/core/api/portale";
import StatusBadge from "@/ui/StatusBadge";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { ToastAction } from "@/ui/primitivi/toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { giornoLezione, formatData, quandoIstante } from "@/core/domain/format";
import { fileIcs, linkGoogleCalendar } from "@/core/domain/ics";
import { CalendarPlus } from "lucide-react";
import { cn } from "@/ui/utils";

// I pezzi di una lezione che Home, Corsi e Le mie lezioni dicono allo stesso modo
// (docs/piani/portale.md, D-3): la pillola dello stato, il termine, Prenota con «Annulla»,
// Disdici, la lista d'attesa, il calendario.

export const ora = (t) => String(t ?? "").slice(0, 5);
/** «Yoga, gio 12 nov 12:15» */
export const nomeLezione = (l) => `${l.corso?.nome ?? "Lezione"}, ${giornoLezione(l.data)} ${ora(l.inizio)}`;
/** Vera se la mia prenotazione è viva: confermata o in lista. */
export const viva = (p) => Boolean(p) && p.stato !== "cancelled";

/** La pillola dello stato della mia prenotazione su una lezione. */
export function PillolaStato({ lezione }) {
  const p = lezione.mia_prenotazione;
  if (lezione.annullata) return <StatusBadge status="annullata" />;
  if (!p) return null;
  if (p.stato === "cancelled") return <StatusBadge status="cancelled" />;
  if (p.posto_offerto_fino_a) return <StatusBadge label="Posto offerto" tone="positivo" />;
  if (p.stato === "waitlisted") return <StatusBadge status="waitlisted" label={p.posizione_attesa ? `In lista d'attesa · ${p.posizione_attesa}°` : undefined} />;
  if (p.fissa) return <StatusBadge label="Fissa" tone="positivo" />;
  return <StatusBadge status={p.stato} />;
}

/** «Puoi disdire fino a domani alle 14:30», o il perché non si può più. */
export function TermineDisdetta({ lezione, className = "" }) {
  if (lezione.finita || lezione.annullata) return null;
  if (lezione.motivo_disdetta_chiusa) return <p className={cn("text-xs text-muted-foreground", className)}>{lezione.motivo_disdetta_chiusa}</p>;
  if (!lezione.disdetta_fino_a) return null;
  const [data, alle] = lezione.disdetta_fino_a.split("T");
  const giorno = giornoLezione(data);
  const quando = /^(Oggi|Domani), /.test(giorno) ? giorno.split(",")[0].toLowerCase() : formatData(data, "giorno");
  return <p className={cn("text-xs text-muted-foreground", className)}>Puoi disdire fino a {quando} alle {alle}</p>;
}

/**
 * «Aggiungi al calendario»: su Android il link di Google Calendar (Chrome non apre un .ics), sugli
 * altri il file .ics, che il telefono apre nel suo calendario.
 */
export function AggiungiAlCalendario({ lezione, palestra, compatto = false, className = "" }) {
  const aggiungi = () => {
    if (/Android/i.test(navigator.userAgent)) {
      window.open(linkGoogleCalendar(lezione, { palestra }), "_blank", "noopener");
      return;
    }
    const url = URL.createObjectURL(new Blob([fileIcs(lezione, { palestra })], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(lezione.corso?.nome ?? "lezione").replace(/[^\w-]+/g, "-")}-${lezione.data}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (compatto) {
    return (
      <Button variant="ghost" size="icon" className={cn("h-11 w-11", className)} onClick={aggiungi} aria-label={`Aggiungi ${nomeLezione(lezione)} al calendario`}>
        <CalendarPlus className="w-4 h-4" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button variant="outline" className={cn("min-h-11", className)} onClick={aggiungi}>
      <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Aggiungi al calendario
    </Button>
  );
}

/**
 * Disdire con una domanda prima: il posto, una volta lasciato, può prenderlo un altro. Chi è in
 * lista «esce dalla lista» (la stessa rotta). Restituisce [disdici(lezione), dialogo, inCorso].
 */
export function useDisdici(onFatto) {
  const [conferma, dialogo] = useConfirm();
  const { toast } = useToast();
  const [inCorso, setInCorso] = useState(false);
  const disdici = async (lezione) => {
    const inLista = lezione.mia_prenotazione?.stato === "waitlisted";
    const ok = await conferma({
      title: inLista ? "Esci dalla lista d'attesa?" : "Disdici la lezione?",
      description: `${nomeLezione(lezione)}.${inLista ? "" : " Il posto torna libero per gli altri."}`,
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

/**
 * Prenotare con un tocco: subito, e poi un messaggio con «Annulla» per 8 secondi (che disdice:
 * nei primi 10 minuti si può sempre). Una lezione piena non si prenota da qui: prima il foglio
 * della lista d'attesa (`FoglioListaAttesa`). Confermare un posto offerto è lo stesso tocco.
 * Restituisce [prenota(lezione), inCorso].
 */
export function usePrenota(onFatto) {
  const { toast } = useToast();
  const [inCorso, setInCorso] = useState(false);
  const prenota = async (lezione) => {
    setInCorso(true);
    try {
      const { prenotazione } = await prenotaLezione(lezione.id);
      const offerta = Boolean(lezione.mia_prenotazione?.posto_offerto_fino_a);
      const annulla = async () => {
        try {
          await disdiciPrenotazione(prenotazione.id);
          toast({ title: "Prenotazione annullata" });
        } catch (err) {
          toast({ title: "Non annullata", description: err.message, variant: "destructive" });
        }
        onFatto?.();
      };
      toast({
        title: prenotazione.stato === "waitlisted"
          ? `In lista d'attesa al ${prenotazione.posizione_attesa}° posto`
          : offerta ? `Posto confermato: ${nomeLezione(lezione)}` : `Prenotata: ${nomeLezione(lezione)}`,
        duration: 8000,
        action: offerta ? undefined : <ToastAction aria-label="Annulla la prenotazione" onClick={annulla}>Annulla</ToastAction>,
      });
      onFatto?.();
    } catch (err) {
      toast({ title: "Non prenotata", description: err.message, variant: "destructive" });
      onFatto?.();
    } finally {
      setInCorso(false);
    }
  };
  return [prenota, inCorso];
}

/**
 * Un foglio: dal basso sul telefono, al centro sul computer. È il Dialog di sempre con un'altra
 * posizione (non c'è un componente Sheet, e non serve una libreria per averlo).
 */
export function Foglio({ aperto, onChiudi, titolo, descrizione, children }) {
  return (
    <Dialog open={aperto} onOpenChange={(v) => { if (!v) onChiudi(); }}>
      <DialogContent className="top-auto bottom-0 left-0 translate-x-0 translate-y-0 max-w-none rounded-t-2xl max-h-[85vh] overflow-y-auto p-5 sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:translate-x-[-50%] sm:translate-y-[-50%] sm:max-w-md sm:rounded-lg">
        <DialogHeader className="text-left pr-6">
          <DialogTitle className="font-heading leading-snug">{titolo}</DialogTitle>
          {descrizione && <DialogDescription>{descrizione}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Il foglio della lezione piena: cosa vuol dire entrare in lista, prima di entrarci. */
export function FoglioListaAttesa({ lezione, onChiudi, onEntra, inCorso }) {
  if (!lezione) return null;
  const posto = (lezione.posti?.in_attesa ?? 0) + 1;
  const chiude = lezione.lista_chiude_il ? quandoIstante(lezione.lista_chiude_il) : null;
  return (
    <Foglio aperto onChiudi={onChiudi} titolo={nomeLezione(lezione)}>
      <p className="text-sm">
        La lezione è piena: entri in lista d'attesa, al {posto}° posto.
        {chiude && <> Se si libera un posto entro {chiude} te lo offriamo: lo trovi in Notifiche e in Home, e hai 12 ore per confermarlo. Dopo quell'ora la lista si chiude e il posto va a chi lo prende per primo.</>}
      </p>
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <Button variant="ghost" className="min-h-11" onClick={onChiudi}>Annulla</Button>
        <Button className="min-h-11" disabled={inCorso} onClick={onEntra}>Entra in lista d'attesa</Button>
      </div>
    </Foglio>
  );
}

/** Una lezione in una riga: corso, giorno e ora, sala; la pillola e le azioni a destra. */
export function RigaLezione({ lezione, senzaGiorno = false, children }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className={cn("text-sm font-medium truncate", lezione.annullata && "line-through text-muted-foreground")}>{lezione.corso?.nome ?? "Lezione"}</p>
        <p className="text-xs text-muted-foreground">
          {senzaGiorno ? ora(lezione.inizio) : `${giornoLezione(lezione.data)} · ${ora(lezione.inizio)}`}{lezione.sala ? ` · ${lezione.sala.nome}` : ""}
        </p>
        <div className="mt-1 sm:hidden"><PillolaStato lezione={lezione} /></div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="hidden sm:inline-flex"><PillolaStato lezione={lezione} /></span>
        {children}
      </div>
    </li>
  );
}
