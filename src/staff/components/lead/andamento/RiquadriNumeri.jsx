import React from "react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { n, pct } from "./comuni";
import { variazione } from "@/core/domain/lead";

/** Il confronto con lo stesso periodo dell'anno prima, in una riga. */
function Confronto({ ora, prima }) {
  const v = variazione(ora, prima);
  if (v === null) return <p className="text-xs text-muted-foreground">Nessun dato l'anno prima</p>;
  const Freccia = v >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-1">
      <Freccia className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="font-medium text-foreground">{v >= 0 ? "+" : ""}{Math.round(v * 100)}%</span> sull'anno prima ({n(prima)})
    </p>
  );
}

function Riquadro({ etichetta, valore, children }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 space-y-1">
        <p className="text-sm text-muted-foreground">{etichetta}</p>
        <p className="text-3xl font-semibold font-heading">{valore}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * I quattro numeri della pagina: quanti contatti, quanti diventati soci, il tasso e quanto ci
 * mettono. Non sono grafici: un numero da solo si legge meglio di una barra sola.
 */
export default function RiquadriNumeri({ ora, prima }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Riquadro etichetta="Contatti" valore={n(ora.contatti)}>
        <Confronto ora={ora.contatti} prima={prima.contatti} />
      </Riquadro>
      <Riquadro etichetta="Diventati soci" valore={n(ora.soci)}>
        <Confronto ora={ora.soci} prima={prima.soci} />
      </Riquadro>
      <Riquadro etichetta="Tasso di conversione" valore={pct(ora.tasso)}>
        <p className="text-xs text-muted-foreground">
          {ora.aperti > 0
            ? `${n(ora.aperti)} ${ora.aperti === 1 ? "contatto ancora in corso" : "contatti ancora in corso"}: il tasso può salire`
            : `L'anno prima: ${pct(prima.tasso)}`}
        </p>
      </Riquadro>
      <Riquadro etichetta="Dal contatto al socio" valore={ora.giorniMedi === null ? "—" : `${n(ora.giorniMedi)} ${ora.giorniMedi === 1 ? "giorno" : "giorni"}`}>
        <p className="text-xs text-muted-foreground">In media, per chi si è iscritto</p>
      </Riquadro>
    </div>
  );
}
