import React from "react";
import { Outlet } from "react-router-dom";
import { LayoutDashboard, CalendarCheck, Wallet } from "lucide-react";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

const tabs = [
  { label: "Dashboard", path: "/pt", icon: LayoutDashboard, end: true },
  { label: "Sedute", path: "/pt/sedute", icon: CalendarCheck },
  { label: "Compensi", path: "/pt/compensi", icon: Wallet },
];

export default function PtLayout() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni PT esterni" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
