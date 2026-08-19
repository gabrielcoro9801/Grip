import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { BookOpen, PlusCircle, Settings, Landmark, Scale, CalendarCheck } from "lucide-react";

const tabs = [
  { label: "Piano dei conti", path: "/contabilita", icon: BookOpen },
  { label: "Nuova registrazione", path: "/contabilita/nuova-registrazione", icon: PlusCircle },
  { label: "Causali operative", path: "/contabilita/causali", icon: Settings },
  { label: "Finanziamenti", path: "/contabilita/finanziamenti", icon: Landmark },
  { label: "Bilancio", path: "/contabilita/bilancio", icon: Scale },
  { label: "Fine esercizio", path: "/contabilita/fine-esercizio", icon: CalendarCheck },
];

export default function AccountingLayout() {
  const location = useLocation();

  const isActive = (path) => {
    if (path === "/contabilita") return location.pathname === "/contabilita";
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