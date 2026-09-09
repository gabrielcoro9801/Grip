import React from "react";
import { Outlet } from "react-router-dom";
import { Users, Wallet, CalendarCheck, Clock, CalendarDays, CalendarOff } from "lucide-react";
import SectionTabs from "@/components/shared/SectionTabs";
import PageContainer from "@/components/shared/PageContainer";

// Il titolo "Team" non sta più sopra le schede: era l'unica sezione ad averlo,
// e le pagine montate sia qui sia sotto /personale cambiavano aspetto a
// seconda della porta da cui ci si arrivava. Il nome della sezione lo dice
// già la voce attiva nella sidebar.
const tabs = [
  { label: "Anagrafica", path: "/team", icon: Users, end: true },
  { label: "Compensi", path: "/team/compensi", icon: Wallet },
  { label: "Sedute", path: "/team/sedute", icon: CalendarCheck },
  { label: "Timbratura", path: "/team/timbratura", icon: Clock },
  { label: "Turni", path: "/team/turni", icon: CalendarDays },
  { label: "Ferie e permessi", path: "/team/ferie", icon: CalendarOff },
];

export default function TeamLayout() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni di Team" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
    </div>
  );
}
