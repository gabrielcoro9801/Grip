import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { quando } from "@/core/domain/daFare";
import { giorniFra, oggiIso } from "@/core/domain/giorni";
import { Contact, CreditCard, UserX, Check, FileUp, Cake, EyeOff } from "lucide-react";

// Le azioni di ogni tipo, da sinistra. «Nascondi avviso» sta a destra, per tutti.
const AZIONI = {
  in_scadenza: ["rinnova", "non_rinnova"],
  scaduto: ["rinnova", "non_rinnova"],
  frequenza: ["contattato"],
  documento: ["carica"],
  compleanno: ["auguri_fatti"],
};
const PULSANTI = {
  rinnova: { etichetta: "Rinnova", icona: CreditCard, variant: "default" },
  non_rinnova: { etichetta: "Non rinnova", icona: UserX, variant: "outline" },
  contattato: { etichetta: "Contattato", icona: Check, variant: "default" },
  carica: { etichetta: "Carica documento", icona: FileUp, variant: "default" },
  auguri_fatti: { etichetta: "Auguri fatti", icona: Cake, variant: "default" },
};

/**
 * La frase dell'avviso, con la data e quanto manca: «Abbonamento in scadenza il 04/11/2026 · tra
 * 4 giorni». «Oggi», «domani» e quello che è già passato sono in rosso (P3); un compleanno
 * passato da due giorni no, non è una scadenza. La Frequenza non ha una data.
 */
function FraseAvviso({ avviso, oggi }) {
  const { frase = "", data = null } = avviso.dati ?? {};
  if (!data || avviso.tipo === "frequenza") return <p className="text-sm text-muted-foreground mt-0.5">{frase}</p>;
  const n = giorniFra(oggi, data);
  const urgente = n === 0 || n === 1 || (n < 0 && avviso.tipo !== "compleanno");
  return (
    <p className="text-sm text-muted-foreground mt-0.5">
      {frase} · <span className={urgente ? "text-destructive font-medium" : ""}>{quando(data, oggi)}</span>
    </p>
  );
}

/**
 * Un avviso di Da fare: chi (con il codice socio in grigio chiaro), perché, e che cosa fare. In
 * alto a destra i recapiti, in una finestrella e senza link; in basso le azioni del tipo e
 * «Nascondi avviso». Niente stato del socio: la scheda dice già perché è qui.
 *
 * La scheda non chiama l'API: dice a chi la mostra quale azione si è scelta (`onAzione`), e lui
 * apre la finestra giusta o chiude l'avviso.
 *
 * @param avviso       una riga di GET /api/avvisi
 * @param puoModificare chi modifica i soci: senza, la scheda si legge e basta
 * @param puoCaricare  chi carica anche i documenti (crm_documents)
 * @param occupato     un'azione su questo avviso è in corso: i pulsanti si spengono
 * @param onAzione     (azione) con azione fra rinnova, non_rinnova, carica, contattato,
 *                     auguri_fatti, nascondi, recapiti
 */
export default function SchedaAvviso({ avviso, oggi = oggiIso(), puoModificare, puoCaricare, occupato, onAzione }) {
  const azioni = (AZIONI[avviso.tipo] ?? []).filter((a) => (a === "carica" ? puoCaricare : true));
  return (
    <Card className="border-0 shadow-sm h-full">
      <CardContent className="p-4 h-full flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium break-words">
              {avviso.socio_id
                ? <Link to={`/crm/soci/${avviso.socio_id}`} className="hover:underline">{avviso.nome}</Link>
                : avviso.nome}
              {avviso.codice_socio && <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground/70">{avviso.codice_socio}</span>}
            </p>
            <FraseAvviso avviso={avviso} oggi={oggi} />
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="Recapiti" aria-label={`Recapiti di ${avviso.nome}`} onClick={() => onAzione("recapiti")}>
            <Contact className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
        {puoModificare && (
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {azioni.map((a) => {
              const p = PULSANTI[a];
              return (
                <Button key={a} type="button" size="sm" variant={p.variant} className="h-9" disabled={occupato} onClick={() => onAzione(a)}>
                  <p.icona className="w-4 h-4" aria-hidden="true" /> {p.etichetta}
                </Button>
              );
            })}
            <Button type="button" size="sm" variant="ghost" className="h-9 ml-auto text-muted-foreground" disabled={occupato} onClick={() => onAzione("nascondi")}>
              <EyeOff className="hidden sm:block w-4 h-4" aria-hidden="true" />
              <span className="sm:hidden">Nascondi</span>
              <span className="hidden sm:inline">Nascondi avviso</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
