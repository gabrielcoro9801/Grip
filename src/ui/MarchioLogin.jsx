import React, { useEffect, useState } from "react";
import { Dumbbell } from "lucide-react";
import { api } from "@/core/api/client";

/**
 * Logo e nome della palestra in cima alle pagine di accesso (gestionale e portale), come li sceglie
 * l'amministratore in Dettagli Societari. Finché non arrivano, o se mancano, il manubrio e "Grip".
 */
export default function MarchioLogin({ area, sottotitolo }) {
  const [palestra, setPalestra] = useState(null);
  useEffect(() => { api.auth.palestra().then(setPalestra).catch(() => {}); }, []);

  return (
    <div className="text-center">
      {/* Lo stesso quadrato verde della barra laterale, solo più grande. */}
      <div className="w-14 h-14 rounded-xl bg-sidebar-primary flex items-center justify-center mx-auto mb-3 overflow-hidden">
        {palestra?.logo_url
          ? <img src={palestra.logo_url} alt="" className="w-full h-full object-contain" />
          : <Dumbbell className="w-7 h-7 text-sidebar-primary-foreground" aria-hidden="true" />}
      </div>
      <h1 className="text-2xl font-heading font-bold">{palestra?.nome || "Grip"}</h1>
      <p className="text-sm font-medium text-muted-foreground">{area}</p>
      <p className="text-sm text-muted-foreground mt-1">{sottotitolo}</p>
    </div>
  );
}
