import React from "react";
import { Numero, n } from "@/staff/components/lead/andamento/comuni";
import { LOCALE } from "@/core/domain/format";

// I mesi dei riquadri, da "YYYY-MM": "novembre", e "nov 2025" per quello dell'anno prima.
const nomeMese = new Intl.DateTimeFormat(LOCALE, { month: "long", timeZone: "UTC" });
const meseBreve = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" });
const aData = (mese) => new Date(`${mese}-01T00:00:00Z`);
const breve = (mese) => meseBreve.formatToParts(aData(mese)).map((p) => (p.type === "month" ? p.value.replace(/\.$/, "") : p.value)).join("");

/**
 * I cinque riquadri sopra gli abbonamenti venduti: venduti nel mese, nel mese prima e nello
 * stesso mese dell'anno prima, attivi oggi, in scadenza. Su tutti gli abbonamenti, non sul filtro
 * della tabella: i numeri vengono da `statisticheVenduti` (shared/abbonamenti.js).
 *
 * Da telefono due colonne, con "In scadenza" a tutta riga; da schermo largo quattro colonne
 * uguali e "In scadenza", che ha tre numeri, più larga.
 */
export default function RiquadriVenduti({ statistiche: s }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-[repeat(4,1fr)_1.5fr] gap-4 mb-6">
      <Numero dueRighe etichetta={`Venduti a ${nomeMese.format(aData(s.mesi.corrente))}`} valore={n(s.venduti.corrente)} />
      <Numero dueRighe etichetta={`Venduti a ${nomeMese.format(aData(s.mesi.precedente))}`} valore={n(s.venduti.precedente)} />
      <Numero dueRighe etichetta={`Venduti a ${breve(s.mesi.annoPrima)}`} valore={n(s.venduti.annoPrima)} />
      <Numero dueRighe etichetta="Attivi oggi" valore={n(s.attivi)}>
        <p className="text-xs text-muted-foreground">{n(s.sociAttivi)} {s.sociAttivi === 1 ? "socio" : "soci"}</p>
      </Numero>
      <Numero
        dueRighe etichetta="In scadenza" className="col-span-2 xl:col-span-1"
        valore={(
          <dl className="flex gap-6">
            {s.inScadenza.map((x) => (
              // Prima l'etichetta, come vuole <dl>; a vista il numero sta sopra.
              <div key={x.mesi} className="flex flex-col-reverse">
                <dt className="text-xs font-normal font-sans text-muted-foreground">entro {x.mesi} {x.mesi === 1 ? "mese" : "mesi"}</dt>
                <dd>{n(x.abbonamenti)}</dd>
              </div>
            ))}
          </dl>
        )}
      >
        <p className="text-xs text-muted-foreground">Abbonamenti attivi, non soci: chi ne ha due conta due volte</p>
      </Numero>
    </div>
  );
}
