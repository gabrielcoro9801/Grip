import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Users, BookOpen, CreditCard, UserPlus } from "lucide-react";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canAccess } from "@/staff/lib/permissions";

// "Elenco soci" e non "Soci": la sezione si chiama già Soci nel menu laterale, e
// una voce che ripete il nome della sezione non dice dove porta.
//
// I piani di allenamento non sono più qui: sono diventati la sezione "Allenamento", che
// contiene anche il catalogo degli esercizi e le schede modello — roba che non appartiene
// a nessun socio e non aveva senso cercare sotto i Soci.
//
// I lead stanno qui e non in una sezione loro: sono i soci di domani, e chi lavora al banco
// passa dall'uno all'altro nella stessa conversazione. Hanno però un permesso proprio, e la
// voce compare solo a chi ce l'ha.
const tabs = [
  { label: "Elenco soci", path: "/crm", icon: Users, end: true },
  { label: "Lead", path: "/crm/lead", icon: UserPlus, modulo: "crm_leads" },
  { label: "Abbonamenti", path: "/crm/abbonamenti", icon: BookOpen },
  { label: "Iscrizioni", path: "/crm/iscrizioni", icon: CreditCard },
];

export default function CrmLayout() {
  const { pathname } = useLocation();
  const { staffUser } = useStaffAuth();

  // La scheda di un socio è una pagina a sé, non una quinta sezione: ci si arriva da un
  // elenco e si torna indietro col suo pulsante. Lasciare la barra delle sezioni sopra
  // suggeriva di essere ancora dentro l'elenco, e nessuna voce risultava attiva — la
  // barra restava lì a non indicare niente. Lo stesso vale per la scheda di un lead.
  const schedaSingola = pathname.startsWith("/crm/soci/") || pathname.startsWith("/crm/lead/");
  const visibili = tabs.filter((t) => !t.modulo || canAccess(staffUser?.ruolo, t.modulo));

  return (
    <div className="flex flex-col h-full">
      {!schedaSingola && <SectionTabs tabs={visibili} label="Sezioni dei soci" />}
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
