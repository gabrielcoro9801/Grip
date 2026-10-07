import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import { formatDataOra } from "@/core/domain/format";
import { DoorOpen } from "lucide-react";

/** Nella scheda socio: l'ultimo ingresso e quanti negli ultimi 30 giorni. */
export default function IngressiSocio({ socioId }) {
  const [ingressi, setIngressi] = useState(null);
  useEffect(() => {
    const oggi = oggiIso();
    api.ingressi.elenco({ member_id: socioId, dal: spostaGiorni(oggi, -29), al: oggi })
      .then((r) => setIngressi(r.ingressi)).catch(() => setIngressi([]));
  }, [socioId]);
  if (ingressi === null) return null;
  return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <DoorOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
      {ingressi.length === 0
        ? "Nessun ingresso negli ultimi 30 giorni."
        : <>Ultimo ingresso {formatDataOra(ingressi[0].entrato_alle)} · {ingressi.length} negli ultimi 30 giorni</>}
      <Link to="/crm/ingressi" className="text-primary hover:underline ml-auto shrink-0">Ingressi</Link>
    </p>
  );
}
