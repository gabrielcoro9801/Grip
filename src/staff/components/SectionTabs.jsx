import React from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/ui/utils";

/**
 * La barra di navigazione interna a una sezione (Contabilità, CRM, Team…).
 *
 * Esisteva in cinque copie leggermente diverse — padding, hover e posizione
 * cambiavano passando da Contabilità a Personale, e chi navigava se ne
 * accorgeva. Questa è l'unica versione: barra a tutta larghezza sotto
 * l'header, sottolineatura sull'elemento attivo, scorrimento orizzontale
 * quando le voci non ci stanno.
 *
 * Il padding del contenuto non vive qui: lo mette il layout con
 * <PageContainer>, così la barra resta a filo dei bordi.
 *
 * @param tabs [{ label, path, icon, end, match }]
 *   `end`   — voce indice: attiva solo sul percorso esatto.
 *   `match` — (pathname) => boolean, per i casi in cui una voce copre anche
 *             rotte che non le stanno sotto (es. Soci copre /crm/soci/:id).
 * @param label nome della navigazione per chi usa uno screen reader.
 */
export default function SectionTabs({ tabs, label = "Navigazione di sezione", className }) {
  const { pathname } = useLocation();

  if (!tabs?.length) return null;

  const isActive = (tab) => {
    if (tab.match) return tab.match(pathname);
    if (tab.end) return pathname === tab.path;
    return pathname === tab.path || pathname.startsWith(`${tab.path}/`);
  };

  return (
    <div className={cn("border-b border-border bg-card overflow-x-auto", className)}>
      <nav aria-label={label} className="flex px-4 sm:px-6 lg:px-8 gap-1">
        {tabs.map((tab) => {
          const attiva = isActive(tab);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              // Il colore da solo non dice a uno screen reader dove ci si trova.
              aria-current={attiva ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                attiva
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              {tab.icon && <tab.icon className="w-4 h-4" aria-hidden="true" />}
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
