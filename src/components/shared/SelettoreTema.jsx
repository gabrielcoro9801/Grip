import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTema } from "@/lib/tema";
import { cn } from "@/lib/utils";

const SCELTE = [
  { valore: "chiaro", etichetta: "Chiaro", icona: Sun },
  { valore: "scuro", etichetta: "Scuro", icona: Moon },
  { valore: "sistema", etichetta: "Come il sistema", icona: Monitor },
];

/**
 * Le tre scelte del tema, in fila.
 *
 * Un gruppo di tre e non un interruttore acceso/spento: con due stati "come il sistema"
 * non si può esprimere, e chi ha il telefono che passa allo scuro la sera se lo ritrova
 * chiaro senza capire perché.
 *
 * @param compatto solo le icone, per la barra laterale ridotta.
 */
export default function SelettoreTema({ compatto = false, className }) {
  const { tema, imposta } = useTema();

  return (
    <div
      role="radiogroup"
      aria-label="Aspetto dell'applicazione"
      className={cn("flex items-center gap-1 rounded-lg bg-muted/50 p-1", className)}
    >
      {SCELTE.map(({ valore, etichetta, icona: Icona }) => {
        const attivo = tema === valore;
        return (
          <button
            key={valore}
            type="button"
            role="radio"
            aria-checked={attivo}
            aria-label={etichetta}
            title={etichetta}
            onClick={() => imposta(valore)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md h-9 px-2 text-xs font-medium transition-colors",
              compatto ? "flex-1" : "flex-1",
              attivo
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icona className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!compatto && <span>{etichetta === "Come il sistema" ? "Auto" : etichetta}</span>}
          </button>
        );
      })}
    </div>
  );
}
