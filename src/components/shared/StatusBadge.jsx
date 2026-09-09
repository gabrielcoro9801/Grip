import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * L'unico modo di mostrare uno stato.
 *
 * Ne convivevano tre: questo componente con la palette scritta a mano, le
 * mappe STATO_LABEL/STATO_VARIANT duplicate in cinque file, e i <Badge> con
 * le classi colore inline. Ora gli stati stanno tutti qui, e i colori
 * passano dai token del tema invece che da bg-emerald-50 & co.
 */

// Cinque toni, non venti colori: è quello che uno stato deve comunicare.
const TONI = {
  positivo: "bg-success/10 text-success border-success/30",
  attesa: "bg-warning/10 text-warning border-warning/30",
  negativo: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-info/10 text-info border-info/30",
  neutro: "bg-muted text-muted-foreground border-border",
};

// Chiave dello stato così come arriva dal backend → etichetta e tono.
// Le chiavi Pending/Shipped/Delivered che stavano qui erano residui del
// template e-commerce da cui nasce il progetto: nessuna era mai usata.
const STATI = {
  // Abbonamenti e iscrizioni
  active: { label: "Attivo", tono: "positivo" },
  expiring: { label: "In scadenza", tono: "attesa" },
  expired: { label: "Scaduto", tono: "negativo" },

  // Prenotazioni ai corsi
  confirmed: { label: "Confermato", tono: "positivo" },
  waitlisted: { label: "In lista d'attesa", tono: "attesa" },
  cancelled: { label: "Cancellato", tono: "neutro" },

  // Sessioni dei corsi
  annullata: { label: "Annullata", tono: "negativo" },

  // Codici di accesso
  attivo: { label: "Attivo", tono: "positivo" },
  revocato: { label: "Revocato", tono: "negativo" },
};

/**
 * @param status chiave dello stato (vedi STATI).
 * @param label  etichetta alternativa, quando il contesto ne chiede una diversa.
 * @param tone   tono forzato, per gli stati che non stanno in tabella.
 */
export default function StatusBadge({ status, label, tone, className }) {
  const noto = STATI[status];
  const tono = TONI[tone] || TONI[noto?.tono] || TONI.neutro;

  return (
    <Badge variant="outline" className={cn("text-xs font-medium", tono, className)}>
      {label ?? noto?.label ?? status}
    </Badge>
  );
}
