import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, CalendarCheck, Wallet } from "lucide-react";

const ptTabs = [
  { label: "Dashboard", path: "/pt", icon: LayoutDashboard, end: true },
  { label: "Sedute", path: "/pt/sedute", icon: CalendarCheck },
  { label: "Compensi", path: "/pt/compensi", icon: Wallet },
];

export default function PtLayout() {
  const location = useLocation();
  const tabs = ptTabs;

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