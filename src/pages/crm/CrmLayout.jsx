import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Users, BookOpen, CreditCard } from "lucide-react";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

// "Elenco soci" e non "Soci": la sezione si chiama già Soci nel menu laterale, e
// una voce che ripete il nome della sezione non dice dove porta.
//
// I piani di allenamento non sono più qui: sono diventati la sezione "Allenamento", che
// contiene anche il catalogo degli esercizi e le schede modello — roba che non appartiene
// a nessun socio e non aveva senso cercare sotto i Soci.
const tabs = [
  { label: "Elenco soci", path: "/crm", icon: Users, end: true },
  { label: "Abbonamenti", path: "/crm/abbonamenti", icon: BookOpen },
  { label: "Iscrizioni", path: "/crm/iscrizioni", icon: CreditCard },
];

export default function CrmLayout() {
  const { pathname } = useLocation();

  // La scheda di un socio è una pagina a sé, non una quinta sezione: ci si arriva da un
  // elenco e si torna indietro col suo pulsante. Lasciare la barra delle sezioni sopra
  // suggeriva di essere ancora dentro l'elenco, e nessuna voce risultava attiva — la
  // barra restava lì a non indicare niente.
  const schedaSocio = pathname.startsWith("/crm/soci/");

  return (
    <div className="flex flex-col h-full">
      {!schedaSocio && <SectionTabs tabs={tabs} label="Sezioni dei soci" />}
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
