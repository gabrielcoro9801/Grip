import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTema } from "@/ui/tema";
import { cn } from "@/ui/utils";

/**
 * L'interruttore del tema: sole a sinistra, luna a destra, e il pomello che scorre.
 *
 * Sta in alto, accanto al nome dell'applicazione, e non dice niente a parole: le due icone
 * bastano, e il nome per chi usa uno screen reader c'è comunque.
 *
 * @param className per adattare il binario allo sfondo su cui sta (la barra laterale è scura
 *                  anche con il tema chiaro).
 */
export default function SelettoreTema({ className }) {
  const { tema, imposta } = useTema();
  const scuro = tema === "scuro";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={scuro}
      aria-label="Tema scuro"
      title={scuro ? "Passa al tema chiaro" : "Passa al tema scuro"}
      onClick={() => imposta(scuro ? "chiaro" : "scuro")}
      className={cn(
        "relative inline-flex items-center shrink-0 h-6 w-11 rounded-full bg-muted text-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Sun className="absolute left-1 w-3.5 h-3.5 opacity-60" aria-hidden="true" />
      <Moon className="absolute right-1 w-3.5 h-3.5 opacity-60" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 flex items-center justify-center h-5 w-5 rounded-full bg-background text-foreground shadow transition-transform duration-200",
          scuro && "translate-x-5"
        )}
      >
        {scuro ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
      </span>
    </button>
  );
}
