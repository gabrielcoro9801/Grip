import React, { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import AzioniPersona from "@/staff/components/segnali/AzioniPersona";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { fase as faseDi, etichettaSegnale } from "@/core/domain/segnali";
import { ListChecks } from "lucide-react";

const VISTE = [
  { valore: "", etichetta: "Tutti" },
  { valore: "soci", etichetta: "Soci" },
  { valore: "lead", etichetta: "Contatti" },
];

/** Dove si apre una persona: la scheda del socio, o il contatto fra i lead. */
const linkDi = (p) => (p.socio_id ? `/crm/soci/${p.socio_id}` : `/lead?q=${encodeURIComponent(p.nome)}`);

/**
 * Oggi: chi seguire, e perché. La prima pagina della reception.
 *
 * La lista la fa il motore dei segnali (GET /api/segnali?da_fare=1), dal più prezioso: prima chi
 * sta andando via — scaduto da poco, in scadenza, assente, in calo — poi i contatti da chiamare,
 * i nuovi da accompagnare, i compleanni. Ogni riga dice perché, in parole, e ha le azioni a
 * portata di pollice: lo staff chiama dal telefono. Registrato il contatto, la riga sparisce per
 * qualche giorno.
 */
export default function Oggi() {
  const { staffUser } = useStaffAuth();
  const [parametri, setParametri] = useSearchParams();
  const tipo = VISTE.some((v) => v.valore === parametri.get("tipo")) ? parametri.get("tipo") : "";
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    api.segnali({ da_fare: "1", tipo }).then(setDati).catch(setErrore);
  }, [tipo]);
  useEffect(() => { setDati(null); carica(); }, [carica]);

  const puoModificare = (p) => canEdit(staffUser?.ruolo, p.socio_id ? "crm_members" : "crm_leads");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <PageHeader title="Oggi" description={dati ? `${dati.persone.length} da seguire, dal più urgente.` : "Chi seguire oggi, e perché."} />

      <div className="flex gap-2 mb-4" role="tablist" aria-label="Chi">
        {VISTE.map((v) => (
          <button
            key={v.valore} type="button" role="tab" aria-selected={tipo === v.valore}
            onClick={() => setParametri(v.valore ? { tipo: v.valore } : {}, { replace: true })}
            className={`px-4 py-1.5 rounded-full text-sm border ${tipo === v.valore ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
          >
            {v.etichetta}
          </button>
        ))}
      </div>

      {errore && <ErrorState error={errore} onRetry={carica} />}
      {!dati && !errore && <LoadingState minHeight="h-64" />}
      {dati && dati.persone.length === 0 && (
        <EmptyState icon={ListChecks} title="Niente da fare" description="Nessuno da seguire adesso: chi è stato contattato torna qui da solo, se serve." />
      )}
      {dati && dati.persone.length > 0 && (
        <ol className="space-y-3">
          {dati.persone.map((p) => {
            const f = faseDi(p.fase);
            return (
              <li key={p.persona_id}>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={linkDi(p)} className="font-medium hover:underline break-words">{p.nome}</Link>
                        <p className="text-sm font-medium text-foreground/90 mt-0.5">{etichettaSegnale(p.da_fare[0])}</p>
                        <p className="text-sm text-muted-foreground">{p.perche}</p>
                      </div>
                      <StatusBadge status={p.fase} label={f.etichetta} tone={f.tono} className="shrink-0" />
                    </div>
                    <AzioniPersona persona={p} puoModificare={puoModificare(p)} onFatto={carica} />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
