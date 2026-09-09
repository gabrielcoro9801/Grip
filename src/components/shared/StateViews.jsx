import React from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Cosa mostrare quando una vista fallisce.
 *
 * Prima esisteva in sei file su una cinquantina: le altre viste restavano
 * sullo spinner per sempre, o mostravano una lista vuota che sembrava un
 * dato ("nessun movimento") invece di un guasto.
 */
export function ErrorState({
  error,
  title = "Non è stato possibile caricare i dati",
  onRetry,
  className,
}) {
  const dettaglio = typeof error === "string" ? error : error?.message;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 py-12 px-4",
        className
      )}
    >
      <AlertCircle className="w-8 h-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {dettaglio && <p className="text-sm text-muted-foreground max-w-md">{dettaglio}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
          Riprova
        </Button>
      )}
    </div>
  );
}

/** Il "non c'è ancora niente": distinto dall'errore, e con la via d'uscita. */
export function EmptyState({
  icon: Icon = Inbox,
  title = "Nessun dato",
  description,
  action,
  className,
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-3 py-12 px-4", className)}>
      <Icon className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground max-w-md">{description}</p>}
      </div>
      {action}
    </div>
  );
}
