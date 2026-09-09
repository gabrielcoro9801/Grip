import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import MemberLogin from "./MemberLogin";
import { LoadingState } from "@/components/shared/Spinner";
import { Dumbbell, Home, FileText, CreditCard, User, QrCode, LogOut, LayoutGrid, ClipboardList } from "lucide-react";

// Una sola lista di destinazioni. Le barre erano due, con nomi diversi per lo
// stesso posto ("QR Accesso" nella sidebar, "QR" in fondo allo schermo):
// `inBasso` dice solo quali voci entrano nella barra del telefono.
const navItems = [
  { label: "Home", path: "/member-portal", icon: Home, end: true, inBasso: true },
  { label: "Corsi", path: "/member-portal/corsi", icon: LayoutGrid, inBasso: true },
  { label: "Allenamento", path: "/member-portal/allenamento", icon: ClipboardList, inBasso: true },
  { label: "Documenti", path: "/member-portal/documenti", icon: FileText },
  { label: "Abbonamento", path: "/member-portal/abbonamento", icon: CreditCard },
  { label: "QR accesso", path: "/member-portal/qr", icon: QrCode, inBasso: true },
  { label: "Anagrafica", path: "/member-portal/anagrafica", icon: User, inBasso: true },
];

const bottomTabs = navItems.filter((item) => item.inBasso);

export default function MemberLayout() {
  const location = useLocation();
  const { memberUser, loading, logout } = useMemberAuth();

  if (loading) {
    return <LoadingState minHeight="min-h-screen" label="Caricamento del portale in corso" />;
  }

  if (!memberUser) {
    return <MemberLogin />;
  }

  const isActive = (path, end) => {
    if (end) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0">
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Dumbbell className="w-4 h-4 text-sidebar-primary-foreground" aria-hidden="true" />
          </div>
          <span className="font-heading font-bold text-lg text-white">Grip</span>
        </div>
        <nav aria-label="Navigazione del portale soci" className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive(item.path, item.end) ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.path, item.end)
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
              }`}
            >
              <item.icon className="w-5 h-5" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-2 border-t border-sidebar-border space-y-2">
          <div className="px-3 py-2 rounded-lg bg-sidebar-accent/50">
            <p className="text-sm font-medium text-white truncate">{memberUser.nome}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 lg:ml-60 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" aria-hidden="true" />
            <span className="font-heading font-bold">Grip</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-muted-foreground hover:text-destructive flex items-center gap-1"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Logout
          </button>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Mobile bottom tab bar */}
        <nav
          aria-label="Navigazione rapida"
          className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-card border-t border-border flex items-center justify-around h-16 px-1"
        >
          {bottomTabs.map(item => {
            const attiva = isActive(item.path, item.end);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={attiva ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs border-t-2 -mt-px ${
                  attiva ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[10px] leading-none">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
