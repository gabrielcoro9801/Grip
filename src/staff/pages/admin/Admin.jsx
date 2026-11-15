import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { useOrganization } from "@/staff/lib/useOrganization";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { ROLES, RUOLI_NON_CONFIGURABILI, canAccess } from "@/staff/lib/permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitivi/tabs";
import PageHeader from "@/staff/components/PageHeader";
import GestioneRuoli from "@/staff/components/admin/GestioneRuoli";
import UtentiInterni from "@/staff/components/admin/UtentiInterni";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";

// Le due schermate di questa pagina: gli utenti (chi accede) e i ruoli (cosa possono fare). Ognuna
// si vede con il suo permesso; la pagina si apre con una delle due.
export default function Admin() {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const vedeUtenti = canAccess(staffUser?.ruolo, "utenti", "view");
  const vedeRuoli = vedeUtenti || canAccess(staffUser?.ruolo, "ruoli", "view");
  const [accounts, setAccounts] = useState([]);
  const [ruoli, setRuoli] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(async () => {
    setErrore(null);
    try {
      const acc = vedeUtenti ? await api.entities.StaffAccount.list() : [];
      // I ruoli sono configurabili dall'ente: leggerli dal server è l'unico modo perché un ruolo
      // creato qui compaia anche dove si assegna. Senza permesso di lettura, i ruoli di base.
      let elenco = Object.entries(ROLES).map(([nome, meta]) => ({ nome, label: meta.label }));
      if (organization?.id && vedeRuoli) {
        try {
          const dati = await api.ruoli.lista(organization.id);
          if (dati?.ruoli?.length) elenco = dati.ruoli.map((r) => ({ nome: r.nome, label: r.label }));
        } catch {
          /* nessun permesso di lettura: restano i ruoli di base */
        }
      }
      setAccounts(acc);
      setRuoli(elenco);
    } catch (err) {
      setErrore(err);
    }
    setLoading(false);
  }, [organization, vedeUtenti, vedeRuoli]);

  useEffect(() => { carica(); }, [carica]);

  // Il ruolo con cui un socio entra nel portale non è un ruolo dello staff: resta fuori da qui.
  const interni = useMemo(() => accounts.filter((a) => !RUOLI_NON_CONFIGURABILI.has(a.ruolo)), [accounts]);
  const ruoliAssegnabili = useMemo(() => ruoli.filter((r) => !RUOLI_NON_CONFIGURABILI.has(r.nome)), [ruoli]);

  if (loading) return <LoadingState minHeight="h-full" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Utenti e ruoli"
        description="Chi accede all'applicazione, con quale ruolo e con quali permessi"
      />

      <Tabs defaultValue={vedeUtenti ? "utenti" : "ruoli"}>
        <TabsList>
          {vedeUtenti && <TabsTrigger value="utenti">Utenti ({interni.length})</TabsTrigger>}
          {vedeRuoli && <TabsTrigger value="ruoli">Ruoli e permessi</TabsTrigger>}
        </TabsList>

        {vedeUtenti && (
          <TabsContent value="utenti" className="mt-4">
            <UtentiInterni accounts={interni} ruoli={ruoliAssegnabili} reload={carica} />
          </TabsContent>
        )}
        {vedeRuoli && (
          <TabsContent value="ruoli" className="mt-4">
            <GestioneRuoli />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
