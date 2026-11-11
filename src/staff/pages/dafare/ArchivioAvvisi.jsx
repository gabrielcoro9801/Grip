import React, { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { api } from "@/core/api/client";
import PageHeader from "@/staff/components/PageHeader";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/primitivi/tabs";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { TIPI_AVVISO, etichettaEsito } from "@/core/domain/daFare";
import { formatDataOra } from "@/core/domain/format";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Archive, RotateCcw } from "lucide-react";

const MASSIMO = 200;

/**
 * L'Archivio di Da fare: gli avvisi chiusi, divisi come la parte principale (una seconda fila con
 * le stesse cinque voci, ognuna con il suo numero). Ci sono anche quelli che si sono chiusi da
 * soli: un rinnovo, un documento caricato, un socio archiviato. Le 200 chiusure più recenti.
 *
 * Una riga dice chi, perché era in lista, com'è stato chiuso, da chi e quando («In automatico»
 * se l'ha chiuso GRIP). Un avviso nascosto si ripristina (P6): torna nella sua scheda.
 */
export default function ArchivioAvvisi() {
  const { aggiornaConteggi } = useOutletContext() ?? {};
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [parametri, setParametri] = useSearchParams();
  const tipo = TIPI_AVVISO.some((t) => t.valore === parametri.get("tipo")) ? parametri.get("tipo") : TIPI_AVVISO[0].valore;
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const [occupato, setOccupato] = useState(null);
  const puoModificare = canEdit(staffUser?.ruolo, "crm_members");

  const carica = useCallback(() => {
    setErrore(null);
    return api.avvisi.lista({ vista: "archivio", tipo })
      .then((d) => { setDati({ ...d, tipo }); aggiornaConteggi?.(d.conteggi); })
      .catch(setErrore);
  }, [tipo, aggiornaConteggi]);
  useEffect(() => { carica(); }, [carica]);

  const ripristina = async (avviso) => {
    setOccupato(avviso.id);
    try {
      await api.avvisi.ripristina(avviso.id);
      toast({ title: `${avviso.nome}: avviso ripristinato`, description: "È tornato nella sua scheda." });
    } catch (err) {
      // Per esempio una Frequenza, se il socio ne ha già un'altra aperta: il server dice perché.
      toast({ title: "Non ripristinato", description: err.message, variant: "destructive" });
    }
    await carica();
    setOccupato(null);
  };

  // Passando a un'altra voce, finché non arriva la sua lista si aspetta: non si mostra quella di prima.
  const pronti = dati?.tipo === tipo;
  const righe = pronti ? dati.avvisi : [];

  return (
    <div>
      <PageHeader title="Archivio" description="Gli avvisi chiusi, a mano o da soli: le 200 chiusure più recenti di ogni scheda." />

      <Tabs value={tipo} onValueChange={(v) => setParametri({ tipo: v }, { replace: true })} className="mb-4">
        <div className="overflow-x-auto">
          <TabsList aria-label="Schede dell'Archivio">
            {TIPI_AVVISO.map((t) => (
              <TabsTrigger key={t.valore} value={t.valore} className="gap-1.5">
                {t.etichetta}
                {dati?.archiviati && <span className="text-xs tabular-nums text-muted-foreground">{dati.archiviati[t.valore] ?? 0}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {errore && <ErrorState error={errore} onRetry={carica} />}
      {!pronti && !errore && <LoadingState minHeight="h-64" />}
      {pronti && righe.length === 0 && (
        <EmptyState icon={Archive} title="Archivio vuoto" description="Qui finiscono gli avvisi di questa scheda quando si chiudono." />
      )}
      {pronti && righe.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {righe.map((a) => (
                <li key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {a.socio_id ? <Link to={`/crm/soci/${a.socio_id}`} className="hover:underline">{a.nome}</Link> : a.nome}
                      {a.codice_socio && <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground/70">{a.codice_socio}</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">{a.dati?.frase}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      <span className="font-medium text-foreground/80">{etichettaEsito(a.esito, a.tipo, dati.soglie)}</span>
                      {" · "}{a.autore_nome || "In automatico"} · {formatDataOra(a.chiuso_il)}
                    </p>
                  </div>
                  {puoModificare && a.esito === "nascosto" && (
                    <Button type="button" size="sm" variant="outline" className="h-9 self-start sm:self-center" disabled={occupato === a.id} onClick={() => ripristina(a)}>
                      <RotateCcw className="w-4 h-4" aria-hidden="true" /> Ripristina
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {righe.length >= MASSIMO && (
        <p className="text-xs text-muted-foreground mt-3">Si vedono le {MASSIMO} chiusure più recenti.</p>
      )}
    </div>
  );
}
