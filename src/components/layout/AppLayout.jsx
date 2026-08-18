import React, { useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { canAccess, ROLES, SIDEBAR_PERMISSIONS } from "@/lib/permissions";
import StaffLogin from "@/pages/StaffLogin";
import {
  LayoutDashboard, Users, ArrowLeftRight, Calendar,
  ChevronLeft, ChevronRight, LogOut, Menu, Dumbbell, Calculator,
  ShieldCheck, ScrollText, Receipt, Store, ClipboardList, Activity, Landmark, UsersRound
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "CRM", path: "/crm", icon: Users },
  { label: "Movimenti", path: "/movimenti", icon: ArrowLeftRight },
  { label: "Vendite", path: "/vendite", icon: Store },
  { label: "Gestione corsi", path: "/calendar", icon: Calendar },
  { label: "Team", path: "/team", icon: UsersRound },
  { label: "Personale", path: "/personale", icon: ClipboardList, roles: ["dipendente"] },
  { label: "PT Esterni", path: "/pt", icon: Activity, roles: ["pt"] },
  { label: "Contabilità", path: "/contabilita", icon: Calculator },
  { label: "Admin & Utenti", path: "/admin", icon: ShieldCheck },
  { label: "Template ricevuta", path: "/receipt-template", icon: Receipt },
  { label: "Log Audit", path: "/audit-log", icon: ScrollText },
  { label: "Profilo Fiscale", path: "/profilo-fiscale", icon: Landmark },
];

export default function AppLayout() {
  const location = useLocation();
  const { staffUser, loading: staffLoading, logout } = useStaffAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Staff auth gate: if no staff profile selected, show staff login
  if (staffLoading) {
    return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }
  if (!staffUser) {
    return <StaffLogin />;
  }

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
  };

  // Filter nav items by permissions
  const visibleNavItems = navItems.filter(item => {
    if (item.roles && !item.roles.includes(staffUser.ruolo)) return false;
    const requiredModule = SIDEBAR_PERMISSIONS[item.path];
    if (!requiredModule) return true; // no permission required
    return canAccess(staffUser.ruolo, requiredModule, "view");
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        flex flex-col bg-sidebar text-sidebar-foreground
        transition-all duration-300 ease-in-out
        ${collapsed ? "w-[68px]" : "w-[240px]"}
        ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
            <Dumbbell className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-heading font-bold text-lg text-white tracking-tight">Grip</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {visibleNavItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors duration-150
                ${isActive(item.path)
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                }
              `}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* Staff user info + logout */}
        <div className="p-2 border-t border-sidebar-border space-y-2">
          {!collapsed && (
            <div className="px-3 py-2 rounded-lg bg-sidebar-accent/50">
              <p className="text-sm font-medium text-white truncate">{staffUser.nome}</p>
              <Badge variant="outline" className="text-[10px] mt-1 border-sidebar-foreground/30 text-sidebar-foreground">
                {ROLES[staffUser.ruolo]?.label || staffUser.ruolo}
              </Badge>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>Cambia profilo</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-card">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" />
            <span className="font-heading font-bold">Grip</span>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            {staffUser.nome}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}