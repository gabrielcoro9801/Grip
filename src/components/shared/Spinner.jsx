import React from "react";
import { cn } from "@/lib/utils";

const MISURE = {
  sm: "w-4 h-4 border-2",
  md: "w-8 h-8 border-4",
  lg: "w-12 h-12 border-4",
};

/**
 * L'indicatore di attesa. Lo stesso blocco era copiato identico in 46 file:
 * l'aspetto era già uniforme, mancava solo il posto dove viveva.
 *
 * `role="status"` + testo nascosto: senza, chi usa uno screen reader sente
 * silenzio mentre la pagina carica.
 */
export default function Spinner({ size = "md", className, label = "Caricamento in corso" }) {
  return (
    <span role="status" className={cn("inline-flex", className)}>
      <span
        className={cn(
          "block border-muted border-t-primary rounded-full animate-spin",
          MISURE[size] || MISURE.md
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Lo spinner centrato in una porzione di pagina, con un'altezza minima sua. */
export function LoadingState({ className, label = "Caricamento in corso", minHeight = "min-h-[200px]" }) {
  return (
    <div className={cn("flex items-center justify-center", minHeight, className)}>
      <Spinner label={label} />
    </div>
  );
}
