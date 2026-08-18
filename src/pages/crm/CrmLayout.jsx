import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Users, BookOpen, CreditCard, ClipboardList, Dumbbell } from "lucide-react";

const tabs = [
  { label: "Soci", path: "/crm", icon: Users },
  { label: "Abbonamenti", path: "/crm/plans", icon: BookOpen },
  { label: "Iscrizioni", path: "/crm/subscriptions", icon: CreditCard },
  { label: "Ricevute", path: "/crm/receipts", icon: ClipboardList },
  { label: "Piani di allenamento", path: "/crm/exercise-plans", icon: Dumbbell },
];

export default function CrmLayout() {
  const location = useLocation();

  const isActive = (path) => {
    if (path === "/crm") return location.pathname === "/crm" || location.pathname.startsWith("/crm/members");
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card overflow-x-auto">
        <nav className="flex px-4 sm:px-6 lg:px-8 gap-1">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={`
                flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 whitespace-nowrap
                transition-colors
                ${isActive(tab.path)
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }
              `}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}