import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Users, Wallet, CalendarCheck, Clock, CalendarDays, CalendarOff } from "lucide-react";

const tabs = [
  { label: "Anagrafica", path: "/team", icon: Users, end: true },
  { label: "Compensi", path: "/team/compensi", icon: Wallet },
  { label: "Sedute", path: "/team/sedute", icon: CalendarCheck },
  { label: "Timbratura", path: "/team/timbratura", icon: Clock },
  { label: "Turni", path: "/team/turni", icon: CalendarDays },
  { label: "Ferie", path: "/team/ferie", icon: CalendarOff },
];

export default function TeamLayout() {
  const location = useLocation();
  const isActive = (path, end) => (end ? location.pathname === path : location.pathname.startsWith(path));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-heading font-bold mb-4">Team</h1>
      <div className="flex flex-wrap gap-1 mb-6 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.path}
            to={t.path}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
              ${isActive(t.path, t.end) ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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