import React from "react";
import { Outlet } from "react-router-dom";
import { BookOpen, PlusCircle, Settings, Landmark, Scale, CalendarCheck } from "lucide-react";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

const tabs = [
  { label: "Piano dei conti", path: "/contabilita", icon: BookOpen, end: true },
  { label: "Nuova registrazione", path: "/contabilita/nuova-registrazione", icon: PlusCircle },
  { label: "Causali operative", path: "/contabilita/causali", icon: Settings },
  { label: "Finanziamenti", path: "/contabilita/finanziamenti", icon: Landmark },
  { label: "Bilancio", path: "/contabilita/bilancio", icon: Scale },
  { label: "Fine esercizio", path: "/contabilita/fine-esercizio", icon: CalendarCheck },
];

export default function AccountingLayout() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni di Contabilità" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer size="form">
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
