import React from "react";
import { Outlet } from "react-router-dom";
import { Users, BookOpen, CreditCard, ClipboardList, Dumbbell } from "lucide-react";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

const tabs = [
  {
    label: "Soci",
    path: "/crm",
    icon: Users,
    // La scheda del singolo socio sta sotto /crm/soci ma appartiene a "Soci":
    // senza questo la barra non evidenzierebbe nulla mentre la si guarda.
    match: (pathname) => pathname === "/crm" || pathname.startsWith("/crm/soci"),
  },
  { label: "Abbonamenti", path: "/crm/abbonamenti", icon: BookOpen },
  { label: "Iscrizioni", path: "/crm/iscrizioni", icon: CreditCard },
  { label: "Ricevute", path: "/crm/ricevute", icon: ClipboardList },
  { label: "Piani di allenamento", path: "/crm/piani-allenamento", icon: Dumbbell },
];

export default function CrmLayout() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni del CRM" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
