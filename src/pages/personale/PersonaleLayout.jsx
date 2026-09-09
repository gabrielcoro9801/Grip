import React from "react";
import { Outlet } from "react-router-dom";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { LayoutDashboard, Clock, CalendarDays, CalendarOff, FileSpreadsheet, Receipt } from "lucide-react";
import { puo } from "@/lib/permissions";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

const allTabs = [
  { label: "Dashboard", path: "/personale", icon: LayoutDashboard, end: true },
  { label: "Timbratura", path: "/personale/timbratura", icon: Clock },
  { label: "Turni", path: "/personale/turni", icon: CalendarDays },
  // Stessa destinazione, stesso nome: da Team si chiamava solo "Ferie".
  { label: "Ferie e permessi", path: "/personale/ferie", icon: CalendarOff },
  { label: "Cedolini", path: "/personale/cedolini", icon: Receipt, soloGestione: true },
  { label: "Presenze", path: "/personale/presenze", icon: FileSpreadsheet, soloGestione: true },
];

export default function PersonaleLayout() {
  const { staffUser } = useStaffAuth();
  const gestisceTutti = puo(staffUser?.ruolo, "gestire_personale");

  const tabs = allTabs.filter((t) => !t.soloGestione || gestisceTutti);

  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni di Personale" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
