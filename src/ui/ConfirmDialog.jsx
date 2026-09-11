import React, { useCallback, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/primitivi/alert-dialog";
import { buttonVariants } from "@/ui/primitivi/button";
import { cn } from "@/ui/utils";

/**
 * La conferma prima di un'azione distruttiva.
 *
 * Cinque punti dell'app chiedevano conferma con `window.confirm()`: finestra
 * di sistema, testo non traducibile, nessuno stile, e in alcuni browser
 * silenziabile dall'utente — su un'eliminazione contabile è un rischio.
 *
 * Si usa come `window.confirm`, ma restituisce una Promise:
 *
 *   const [conferma, dialogoConferma] = useConfirm();
 *   ...
 *   if (!(await conferma({ title: "Eliminare il conto?", destructive: true }))) return;
 *   ...
 *   return (<>{dialogoConferma}...</>);
 */
export function useConfirm() {
  const [richiesta, setRichiesta] = useState(null);

  const conferma = useCallback(
    (opzioni) => new Promise((resolve) => setRichiesta({ ...opzioni, resolve })),
    []
  );

  const chiudi = (esito) => {
    richiesta?.resolve(esito);
    setRichiesta(null);
  };

  const elemento = (
    <ConfirmDialog
      open={!!richiesta}
      title={richiesta?.title}
      description={richiesta?.description}
      confirmLabel={richiesta?.confirmLabel}
      cancelLabel={richiesta?.cancelLabel}
      destructive={richiesta?.destructive}
      onConfirm={() => chiudi(true)}
      onCancel={() => chiudi(false)}
    />
  );

  return [conferma, elemento];
}

export default function ConfirmDialog({
  open,
  title = "Confermi l'operazione?",
  description,
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  destructive = false,
  onConfirm,
  onCancel,
}) {
  return (
    <AlertDialog open={open} onOpenChange={(aperto) => !aperto && onCancel?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
