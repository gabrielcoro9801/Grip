import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { LayoutDashboard, Clock, CalendarDays, CalendarOff, FileSpreadsheet, Receipt } from "lucide-react";
import { puo } from "@/lib/permissions";

const allTabs = [
  { label: "Dashboard", path: "/personale", icon: LayoutDashboard, end: true },
  { label: "Timbratura", path: "/personale/timbratura", icon: Clock },
  { label: "Turni", path: "/personale/turni", icon: CalendarDays },
  { label: "Ferie & Permessi", path: "/personale/ferie", icon: CalendarOff },
  { label: "Cedolini", path: "/personale/cedolini", icon: Receipt, soloGestione: true },
  { label: "Presenze (Export)", path: "/personale/presenze", icon: FileSpreadsheet, soloGestione: true },
];

export default function PersonaleLayout() {
  const { staffUser } = useStaffAuth();
  const location = useLocation();
  const gestisceTutti = puo(staffUser?.ruolo, "gestire_personale");

  const tabs = allTabs.filter((t) => !t.soloGestione || gestisceTutti);

  const isActive = (path, end) => {
    if (end) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap gap-1 mb-6 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.path}
            to={t.path}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
              ${isActive(t.path, t.end)
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </Link>
        ))}
      </div>
      <Outlet />
    </div>
  );
}