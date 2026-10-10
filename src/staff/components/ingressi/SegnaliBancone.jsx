import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { useToast } from "@/ui/primitivi/use-toast";
import { Sparkles, Check } from "lucide-react";

const AZIONI = {
  proposta_rinnovo: { esito: "proposto_rinnovo", etichetta: "Proposto il rinnovo" },
  saluto: { esito: "salutato", etichetta: "Salutato" },
};

/**
 * Accanto al semaforo: che cosa dire a chi sta entrando — il rinnovo da proporre, il bentornato,
 * gli auguri, il traguardo — e un tocco per segnarlo nel diario. Segnato, il segnale non si
 * ripropone (il rinnovo per qualche giorno, il saluto per oggi).
 *
 * @param segnali i segnali con pubblico "bancone" della verifica: [{ codice, motivo, azioni }]
 */
export default function SegnaliBancone({ personaId, segnali = [], puoRegistrare }) {
  const { toast } = useToast();
  const [fatti, setFatti] = useState([]);
  if (!segnali.length) return null;

  const segna = async (s) => {
    const azione = AZIONI[s.azioni[0]] ?? AZIONI.saluto;
    try {
      await api.persone.contatto(personaId, { canale: "di_persona", esito: azione.esito });
      setFatti((f) => [...f, s.codice]);
    } catch (err) {
      toast({ title: "Non segnato nel diario", description: err.message, variant: "destructive" });
    }
  };

  return (
    <ul className="space-y-2 rounded-lg bg-background/70 p-3" aria-label="Da dire a chi entra">
      {segnali.map((s) => {
        const azione = AZIONI[s.azioni[0]] ?? AZIONI.saluto;
        const fatto = fatti.includes(s.codice);
        return (
          <li key={s.codice} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-start gap-2 font-medium">
              <Sparkles className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" /> {s.motivo}
            </span>
            {fatto ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Nel diario</span>
            ) : puoRegistrare && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => segna(s)}>{azione.etichetta}</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
