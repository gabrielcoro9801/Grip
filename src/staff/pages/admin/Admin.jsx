import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { useOrganization } from "@/staff/lib/useOrganization";
import { ROLES, RUOLI_NON_CONFIGURABILI } from "@/staff/lib/permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitivi/tabs";
import PageHeader from "@/staff/components/PageHeader";
import GestioneRuoli from "@/staff/components/admin/GestioneRuoli";
import UtentiInterni from "@/staff/components/admin/UtentiInterni";
import AccountSoci from "@/staff/components/admin/AccountSoci";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";

// Il ruolo con cui un socio entra nel portale non è un ruolo dello staff: è il confine che
// divide questa schermata in due. `RUOLI_NON_CONFIGURABILI` è già il posto dove quel
// confine è dichiarato una volta sola, e vale anche qui.
const eRuoloSocio = (nome) => RUOLI_NON_CONFIGURABILI.has(nome);

export default function Admin() {
  const { organization } = useOrganization();
  const [accounts, setAccounts] = useState([]);
  const [collaboratori, setCollaboratori] = useState([]);
  const [members, setMembers] = useState([]);
  const [ruoli, setRuoli] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  const carica = useCallback(async () => {
    setErrore(null);
    try {
      const [acc, coll, mem] = await Promise.all([
        api.entities.StaffAccount.list(),
        organization?.id
          ? api.entities.Collaboratore.filter({ organization_id: organization.id })
          : api.entities.Collaboratore.list(),
        api.entities.Member.list(),
      ]);

      // I ruoli sono configurabili dall'ente: leggerli dal server è l'unico modo perché un
      // ruolo creato qui dentro compaia anche dove si assegna. Prima l'elenco veniva dalla
      // costante del codice, e un ruolo nuovo restava invisibile al form degli account.
      // La costante resta come ripiego per chi amministra gli utenti in sola lettura, che
      // sull'API dei ruoli riceve un 403.
      let elenco = Object.entries(ROLES).map(([nome, meta]) => ({ nome, label: meta.label }));
      if (organization?.id) {
        try {
          const dati = await api.ruoli.lista(organization.id);
          if (dati?.ruoli?.length) elenco = dati.ruoli.map((r) => ({ nome: r.nome, label: r.label }));
        } catch {
          /* nessun permesso di configurazione: restano i ruoli di base */
        }
      }

      setAccounts(acc);
      setCollaboratori(coll);
      setMembers(mem);
      setRuoli(elenco);
    } catch (err) {
      setErrore(err);
    }
    setLoading(false);
  }, [organization]);

  useEffect(() => { carica(); }, [carica]);

  // Due popolazioni con cicli di vita opposti: qualche account interno, creato a mano e
  // raramente, contro un account per socio, creato dalla sua scheda. Nella stessa lista il
  // primo gruppo spariva dentro il secondo.
  const { interni, soci } = useMemo(() => ({
    interni: accounts.filter((a) => !eRuoloSocio(a.ruolo)),
    soci: accounts.filter((a) => eRuoloSocio(a.ruolo)),
  }), [accounts]);

  const ruoliAssegnabili = useMemo(
    () => ruoli.filter((r) => !eRuoloSocio(r.nome)),
    [ruoli],
  );

  if (loading) return <LoadingState minHeight="h-full" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Utenti e ruoli"
        description="Chi accede all'applicazione, con quale ruolo e con quali permessi"
      />

      <Tabs defaultValue="interni">
        <TabsList>
          <TabsTrigger value="interni">Utenti interni ({interni.length})</TabsTrigger>
          <TabsTrigger value="soci">Account soci ({soci.length})</TabsTrigger>
          <TabsTrigger value="ruoli">Ruoli e permessi</TabsTrigger>
        </TabsList>

        <TabsContent value="interni" className="mt-4">
          <UtentiInterni
            accounts={interni}
            collaboratori={collaboratori}
            ruoli={ruoliAssegnabili}
            reload={carica}
          />
        </TabsContent>

        <TabsContent value="soci" className="mt-4">
          <AccountSoci accounts={soci} members={members} reload={carica} />
        </TabsContent>

        <TabsContent value="ruoli" className="mt-4">
          <GestioneRuoli />
        </TabsContent>
      </Tabs>
    </div>
  );
}
