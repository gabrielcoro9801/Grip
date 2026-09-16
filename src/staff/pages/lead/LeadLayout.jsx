import React from "react";
import { Outlet } from "react-router-dom";
import { Contact, BarChart3, Share2 } from "lucide-react";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";

// I lead in una sezione loro, separata dai Soci: un contatto non ha scheda, abbonamento né
// accesso, e mescolarlo con chi è già iscritto faceva sembrare socio chi non lo è.
// L'andamento dei contatti sta qui dentro e non nella Dashboard: serve a chi lavora sui lead.
const tabs = [
  { label: "Contatti", path: "/lead", icon: Contact, end: true },
  { label: "Andamento", path: "/lead/andamento", icon: BarChart3 },
  { label: "Canali", path: "/lead/canali", icon: Share2 },
];

export default function LeadLayout() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni dei lead" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
