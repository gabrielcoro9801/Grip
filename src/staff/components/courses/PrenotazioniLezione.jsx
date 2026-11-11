import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import StatusBadge from "@/ui/StatusBadge";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { Repeat, Trash2, X } from "lucide-react";

const nomeDi = (p) => `${p.nome} ${p.cognome}`.trim();

/**
 * Le prenotazioni di una lezione: chi entra, chi aspetta (nel suo ordine), chi ha disdetto.
 *
 * Per riga nome e cognome, codice, stato e «Fissa» se la prenotazione nasce da una prenotazione
 * fissa. Si disdice — la riga resta, il posto passa al primo in lista — o si elimina quella
 * inserita per errore. Le altre azioni sulla lista d'attesa non hanno più un pulsante: le rotte
 * restano, e il server promuove da solo chi aspetta.
 *
 * @param prenotazioni  come le dà GET /api/calendario/lezioni/:id, già in ordine
 * @param modificabile  se si può disdire ed eliminare (permesso, e lezione non finita)
 * @param linkAlSocio   se il nome porta alla scheda del socio
 */
export default function PrenotazioniLezione({ prenotazioni, modificabile, linkAlSocio, onCambiato }) {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [inCorso, setInCorso] = useState(false);

  const esegui = async (azione, riuscita) => {
    setInCorso(true);
    try {
      const esito = await azione();
      const promossi = esito?.promossi ?? [];
      toast({
        title: riuscita,
        description: promossi.length ? `Dalla lista d'attesa: ${promossi.map((p) => p.member_name).join(", ")}.` : undefined,
      });
      onCambiato();
    } catch (err) {
      toast({ title: "Operazione non riuscita", description: err.message, variant: "destructive" });
    } finally {
      setInCorso(false);
    }
  };

  const disdici = async (p) => {
    const ok = await conferma({
      title: `Disdire la prenotazione di ${nomeDi(p)}?`,
      description: p.status === "confirmed" ? "Il posto si libera, e il primo in lista d'attesa viene confermato." : undefined,
      confirmLabel: "Disdici",
      cancelLabel: "Lascia com'è",
      destructive: true,
    });
    if (ok) await esegui(() => api.prenotazioni.cambiaStato(p.id, "cancelled"), `${nomeDi(p)}: prenotazione disdetta`);
  };

  const elimina = async (p) => {
    const ok = await conferma({
      title: `Eliminare la prenotazione di ${nomeDi(p)}?`,
      description: "Sparisce anche dallo storico, come se non fosse mai stata fatta: serve per quelle inserite per errore. Per una disdetta usa «Disdici»: la riga resta.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (ok) await esegui(() => api.prenotazioni.elimina(p.id), "Prenotazione eliminata");
  };

  if (!prenotazioni.length) {
    return <p className="text-sm text-muted-foreground py-4">Nessuna prenotazione.</p>;
  }

  return (
    <>
      {dialogoConferma}
      <ul className="divide-y divide-border/60">
        {prenotazioni.map((p) => (
          <li key={p.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex-1 min-w-[10rem] text-sm">
              {linkAlSocio
                ? <Link to={`/crm/soci/${p.member_id}`} className="font-medium hover:underline">{nomeDi(p)}</Link>
                : <span className="font-medium">{nomeDi(p)}</span>}
              <span className="ml-2 text-xs text-muted-foreground tabular-nums">{p.codice_socio}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge
                status={p.status}
                label={p.status === "waitlisted" ? `In lista · ${p.waitlist_position ?? "?"}°` : undefined}
              />
              {p.prenotazione_fissa_id && (
                <StatusBadge status="fissa" tone="info" label={<><Repeat className="w-3 h-3 mr-1" aria-hidden="true" />Fissa</>} />
              )}
            </span>
            {modificabile && (
              <span className="flex items-center">
                {p.status !== "cancelled" && (
                  <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={`Disdici ${nomeDi(p)}`} disabled={inCorso} onClick={() => disdici(p)}>
                    <X className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Disdici
                  </Button>
                )}
                {/* Disdire lascia la riga (il socio aveva prenotato); eliminare la cancella, per
                    quella inserita per errore: il cestino sta in fondo, staccato da un filo. */}
                <span className="ml-1 pl-1 border-l border-border">
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Elimina: inserita per errore"
                    aria-label={`Elimina la prenotazione di ${nomeDi(p)}, inserita per errore`} disabled={inCorso} onClick={() => elimina(p)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
