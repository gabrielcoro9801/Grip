import React from "react";
import { Badge } from "@/ui/primitivi/badge";
import { cn } from "@/ui/utils";

/**
 * L'unico modo di mostrare uno stato.
 *
 * Ne convivevano tre: questo componente con la palette scritta a mano, le
 * mappe STATO_LABEL/STATO_VARIANT duplicate in cinque file, e i <Badge> con
 * le classi colore inline. Ora gli stati stanno tutti qui, e i colori
 * passano dai token del tema invece che da bg-success/10 & co.
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

  // Tipi di abbonamento del catalogo (attivo è già sopra)
  sospeso: { label: "Sospeso", tono: "attesa" },
  annullato: { label: "Annullato", tono: "negativo" },
  revocato: { label: "Revocato", tono: "negativo" },
};

const PUNTI = {
  positivo: "bg-success",
  attesa: "bg-warning",
  negativo: "bg-destructive",
  info: "bg-info",
  neutro: "bg-muted-foreground",
};

/**
 * Lo stato del socio (Nuovo, Attivo, In calo…): un punto colorato e la parola, su fondo neutro.
 *
 * Ha una forma sua perché dice un'altra cosa. Con lo stesso badge verde "Attivo" voleva dire il
 * socio, l'abbonamento, un tipo del listino e un account, e "Nuovo" un socio o un contatto:
 * accanto, nella stessa riga, non si capiva quale fosse quale. I badge colorati restano agli
 * oggetti (abbonamenti, prenotazioni, documenti); le persone hanno il punto.
 *
 * @param tone uno dei toni dei badge, per il colore del punto.
 */
export function StatoSocio({ label, tone, title, className }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground whitespace-nowrap", className)}>
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full shrink-0", PUNTI[tone] ?? PUNTI.neutro)} />
      {label}
    </span>
  );
}

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
