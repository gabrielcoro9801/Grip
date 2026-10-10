import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import StatusBadge from "@/ui/StatusBadge";
import AzioniPersona from "@/staff/components/segnali/AzioniPersona";
import SegnaliBancone from "@/staff/components/ingressi/SegnaliBancone";
import { formatData } from "@/core/domain/format";
import { fase as faseDi } from "@/core/domain/segnali";

/**
 * In testa alla scheda: in che fase è il socio, che cosa c'è da fare e perché, e le azioni per
 * farlo. Le stesse regole e gli stessi pulsanti di Oggi (shared/segnali.js).
 *
 * Un segnale già lavorato non sparisce qui come in Oggi: resta, con il giorno in cui torna.
 */
export default function SituazioneSocio({ personaId, puoModificare, onFatto }) {
  const [persona, setPersona] = useState(null);

  const carica = useCallback(() => {
    api.segnali({ persona: personaId }).then((d) => setPersona(d.persone[0] ?? null)).catch(() => setPersona(null));
  }, [personaId]);
  useEffect(() => { carica(); }, [carica]);

  if (!persona) return null;
  const f = faseDi(persona.fase);
  const fatto = () => { carica(); onFatto?.(); };

  return (
    <section aria-label="Situazione" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={persona.fase} label={f.etichetta} tone={f.tono} />
        {persona.ultimo_ingresso && <span className="text-xs text-muted-foreground">Ultimo ingresso {formatData(persona.ultimo_ingresso, "breve")}</span>}
        {persona.ingressi_4 !== null && <span className="text-xs text-muted-foreground">· {persona.ingressi_4} ingressi in 4 settimane</span>}
      </div>
      {persona.segnali.length > 0 && (
        <ul className="space-y-1">
          {persona.segnali.map((s, i) => (
            <li key={`${s.codice}-${i}`} className={`text-sm ${s.nascosto_fino ? "text-muted-foreground" : ""}`}>
              <span className="font-medium">{s.titolo}</span>: {s.motivo}
              {s.nascosto_fino && <span className="text-xs"> · già seguito, torna il {formatData(s.nascosto_fino, "breve")}</span>}
            </li>
          ))}
        </ul>
      )}
      {/* È entrato oggi: quello che gli va detto, come in cima a Oggi. */}
      <SegnaliBancone personaId={persona.persona_id} segnali={persona.bancone ?? []} puoRegistrare={puoModificare} />
      <AzioniPersona persona={persona} puoModificare={puoModificare} onFatto={fatto} />
    </section>
  );
}
