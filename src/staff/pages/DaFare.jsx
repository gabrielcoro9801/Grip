import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import AzioniPersona from "@/staff/components/segnali/AzioniPersona";
import SegnaliBancone from "@/staff/components/ingressi/SegnaliBancone";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canAccess, canEdit } from "@/staff/lib/permissions";
import { fase as faseDi, LINEE, regolaSegnale } from "@/core/domain/segnali";
import { ListChecks, DoorOpen, Settings2 } from "lucide-react";

/** Dove si apre una persona: la scheda del socio, o il contatto fra i lead. */
const linkDi = (p) => (p.socio_id ? `/crm/soci/${p.socio_id}` : `/lead?q=${encodeURIComponent(p.nome)}`);

/**
 * Da fare: chi seguire, e perché, diviso per linee — Rinnovi, Chi non viene, Nuovi soci,
 * Documenti, Compleanni, Contatti. Una linea alla volta: ognuna è un lavoro diverso, con la sua
 * azione (shared/segnali.js, LINEE), e tutte insieme erano rumore.
 *
 * La lista la fa il motore dei segnali (GET /api/segnali?da_fare=1). Ogni riga dice perché, in
 * parole, e ha le azioni a portata di pollice. Un "Fatto" toglie la riga da quella linea per
 * qualche giorno; rinnovo e documento la tolgono da soli, quando ci sono. I segnali che la
 * palestra ha spento (Impostazioni › Da fare) non arrivano proprio.
 *
 * In cima, chi è entrato oggi e ha qualcosa da sentirsi dire — il rinnovo, il bentornato, gli
 * auguri: il controllo degli ingressi è passivo (il tornello), e altrimenti non lo vedrebbe nessuno.
 */
export default function DaFare() {
  const { staffUser } = useStaffAuth();
  const ruolo = staffUser?.ruolo;
  const [parametri, setParametri] = useSearchParams();
  const [dati, setDati] = useState(null);
  const [entrati, setEntrati] = useState([]);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    api.segnali({ da_fare: "1" }).then(setDati).catch(setErrore);
    // Chi è passato dal tornello non lo vede nessuno: qui, quello che gli va detto. Solo soci.
    if (canAccess(ruolo, "crm_members", "view")) api.segnali({ entrati_oggi: "1", tipo: "soci" }).then((d) => setEntrati(d.persone)).catch(() => setEntrati([]));
  }, [ruolo]);
  useEffect(() => { carica(); }, [carica]);

  // Le linee che hanno senso per chi guarda: quella dei contatti a chi segue i lead, le altre a chi
  // segue i soci; e non quelle con tutti i segnali spenti dalla palestra.
  const linee = useMemo(() => {
    const spenti = new Set(dati?.soglie?.segnaliSpenti ?? []);
    return LINEE.filter((l) => !l.soloImpostazioni
      && canAccess(ruolo, l.valore === "contatti" ? "crm_leads" : "crm_members", "view")
      && l.segnali.some((s) => !spenti.has(s)));
  }, [dati, ruolo]);
  const conteggi = dati?.conteggi?.linee ?? {};
  // Senza scelta, la prima linea con qualcosa dentro: si apre la pagina e si lavora.
  const scelta = linee.find((l) => l.valore === parametri.get("linea"))
    ?? linee.find((l) => conteggi[l.valore]) ?? linee[0];
  const scegli = (v) => setParametri({ linea: v }, { replace: true });

  const righe = useMemo(() => {
    if (!dati || !scelta) return [];
    return dati.persone
      .map((p) => {
        const suoi = p.segnali.filter((s) => !s.nascosto_fino && scelta.segnali.includes(s.codice));
        return { p, suoi, priorita: suoi[0]?.priorita ?? 0 };
      })
      .filter((r) => r.suoi.length)
      .sort((a, b) => b.priorita - a.priorita || String(a.p.nome).localeCompare(String(b.p.nome), "it"));
  }, [dati, scelta]);

  const puoModificare = (p) => canEdit(ruolo, p.socio_id ? "crm_members" : "crm_leads");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <PageHeader title="Da fare" description="Chi seguire, e perché: una linea di lavoro alla volta.">
        {canEdit(ruolo, "admin_users") && (
          <Link to="/admin/da-fare" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <Settings2 className="w-4 h-4" aria-hidden="true" /> Impostazioni
          </Link>
        )}
      </PageHeader>

      {entrati.length > 0 && (
        <section aria-labelledby="entrati-oggi" className="mb-6">
          <h2 id="entrati-oggi" className="text-sm font-heading font-semibold mb-2 flex items-center gap-2">
            <DoorOpen className="w-4 h-4" aria-hidden="true" /> Entrati oggi
          </h2>
          <ul className="space-y-2">
            {entrati.map((p) => (
              <li key={p.persona_id}>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <Link to={linkDi(p)} className="font-medium hover:underline break-words">{p.nome}</Link>
                    <SegnaliBancone personaId={p.persona_id} segnali={p.bancone} puoRegistrare={puoModificare(p)} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {errore && <ErrorState error={errore} onRetry={carica} />}
      {!dati && !errore && <LoadingState minHeight="h-64" />}

      {dati && (
        <>
          {/* Le linee: un filtro vuoto si vede lo stesso, spento — sapere che non c'è niente da
              rinnovare è un'informazione. */}
          <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Linee di lavoro">
            {linee.map((l) => {
              const attiva = scelta?.valore === l.valore;
              const n = conteggi[l.valore] ?? 0;
              return (
                <button
                  key={l.valore} type="button" role="tab" aria-selected={attiva} onClick={() => scegli(l.valore)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    attiva ? "bg-primary text-primary-foreground border-primary"
                      : n > 0 ? "border-border hover:bg-muted/50" : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {l.etichetta}
                  <span className={`min-w-[1.25rem] px-1 rounded-full text-xs tabular-nums ${attiva ? "bg-primary-foreground/20" : "bg-muted"}`}>{n}</span>
                </button>
              );
            })}
          </div>

          {righe.length === 0 ? (
            <EmptyState icon={ListChecks} title="Niente da fare qui" description="Chi è stato seguito torna da solo, se serve ancora." />
          ) : (
            <ol className="space-y-3">
              {righe.map(({ p, suoi }) => {
                const f = faseDi(p.fase);
                return (
                  <li key={p.persona_id}>
                    <Card className="border-0 shadow-sm">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={linkDi(p)} className="font-medium hover:underline break-words">{p.nome}</Link>
                            {suoi.map((s) => (
                              <p key={s.codice} className="text-sm mt-0.5" title={`Scatta quando: ${regolaSegnale(s.codice, dati.soglie)}`}>
                                <span className="font-medium text-foreground/90">{s.titolo}</span>
                                <span className="text-muted-foreground"> · {s.motivo}</span>
                              </p>
                            ))}
                          </div>
                          <StatusBadge status={p.fase} label={f.etichetta} tone={f.tono} className="shrink-0" />
                        </div>
                        <AzioniPersona persona={p} linea={scelta.valore} segnali={suoi.map((s) => s.codice)} puoModificare={puoModificare(p)} onFatto={carica} />
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
