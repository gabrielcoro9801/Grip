import React, { Suspense, useState, useEffect, useCallback } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useMemberAuth } from "@/member/session/MemberAuthContext";
import MemberLogin from "./MemberLogin";
import { LoadingState } from "@/ui/Spinner";
import { CambioPasswordObbligatorio } from "@/ui/CambioPassword";
import { contaNotificheEAvvisi } from "@/core/api/portale";
import { api } from "@/core/api/client";
import { Dumbbell, Home, CreditCard, LayoutGrid, Bell, CalendarCheck } from "lucide-react";

// Una sola lista di destinazioni (docs/piani/portale.md, D-2): le quattro voci della barra del
// telefono, e sul computer anche Notifiche, che sul telefono è la campanella in alto. Il Profilo
// non è una voce: lo apre l'avatar, come in ogni app.
const navItems = [
  { label: "Home", path: "/member-portal", icon: Home, end: true, inBasso: true },
  { label: "Corsi", path: "/member-portal/corsi", icon: LayoutGrid, inBasso: true },
  { label: "Le mie lezioni", path: "/member-portal/lezioni", icon: CalendarCheck, inBasso: true },
  { label: "Abbonamento", path: "/member-portal/abbonamento", icon: CreditCard, inBasso: true },
  { label: "Notifiche", path: "/member-portal/notifiche", icon: Bell, notifiche: true },
];

const bottomTabs = navItems.filter((item) => item.inBasso);
const PERCORSO_NOTIFICHE = "/member-portal/notifiche";
const PERCORSO_PROFILO = "/member-portal/profilo";

/** Le iniziali del nome, al massimo due: «Giulia Rossi» → «GR». */
const iniziali = (nome) => String(nome ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

/** Il pallino col numero delle notifiche da leggere; niente se sono zero. */
function Contatore({ n, className = "" }) {
  if (!n) return null;
  return (
    <span className={`min-w-[1.25rem] h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold leading-5 text-center tabular-nums ${className}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Avatar({ nome, className = "" }) {
  return (
    <span aria-hidden="true" className={`w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center shrink-0 ${className}`}>
      {iniziali(nome)}
    </span>
  );
}

export default function MemberLayout() {
  const location = useLocation();
  const { memberUser, loading, logout, aggiornaUtente } = useMemberAuth();
  // Quante cose aspettano il socio: notifiche da leggere più avvisi aperti (l'abbonamento). Si
  // richiede a ogni cambio di pagina e ogni volta che il portale torna in primo piano
  // (`visibilitychange`): dal telefono si esce e si rientra senza cambiare pagina. La pagina
  // delle notifiche azzera le non lette quando le segna lette.
  const [conteggio, setConteggio] = useState({ non_lette: 0, avvisi: 0, avvisi_gravi: false });
  const puoChiedere = Boolean(memberUser && !memberUser.password_da_cambiare);
  const conta = useCallback(() => contaNotificheEAvvisi().then(setConteggio).catch(() => {}), []);
  useEffect(() => {
    if (puoChiedere) conta();
  }, [puoChiedere, conta, location.pathname]);
  useEffect(() => {
    if (!puoChiedere) return undefined;
    const torna = () => { if (document.visibilityState === "visible") conta(); };
    document.addEventListener("visibilitychange", torna);
    return () => document.removeEventListener("visibilitychange", torna);
  }, [puoChiedere, conta]);
  const nonLette = conteggio.non_lette + conteggio.avvisi;
  // Nome e logo della palestra (Dettagli Societari nel gestionale), come nel menu dello staff.
  const [palestra, setPalestra] = useState(null);
  useEffect(() => { api.auth.palestra().then(setPalestra).catch(() => {}); }, []);
  const nome = palestra?.nome || "Grip";

  if (loading) {
    return <LoadingState minHeight="min-h-screen" label="Caricamento del portale in corso" />;
  }

  if (!memberUser) {
    return <MemberLogin />;
  }

  // La password data dalla reception si cambia prima di tutto il resto: il server rifiuterebbe
  // comunque ogni altra richiesta.
  if (memberUser.password_da_cambiare) {
    return <CambioPasswordObbligatorio nome={memberUser.nome} onCambiata={aggiornaUtente} onEsci={logout} />;
  }

  const isActive = (path, end) => {
    if (end) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <div className="portale min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0">
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
            {palestra?.logo_url
              ? <img src={palestra.logo_url} alt="" className="w-full h-full object-contain" />
              : <Dumbbell className="w-4 h-4 text-sidebar-primary-foreground" aria-hidden="true" />}
          </div>
          <span className="font-heading font-bold text-lg text-white truncate">{nome}</span>
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
              <span className="flex-1">{item.label}</span>
              {item.notifiche && <Contatore n={nonLette} />}
              {item.notifiche && nonLette > 0 && <span className="sr-only">, {nonLette} da vedere</span>}
            </Link>
          ))}
        </nav>
        <div className="p-2 border-t border-sidebar-border">
          <Link
            to={PERCORSO_PROFILO}
            aria-current={isActive(PERCORSO_PROFILO) ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive(PERCORSO_PROFILO) ? "bg-sidebar-accent text-sidebar-primary" : "hover:bg-sidebar-accent"}`}
          >
            <Avatar nome={memberUser.nome} />
            <span className="min-w-0">
              <span className="block font-medium text-white truncate">{memberUser.nome}</span>
              <span className="block text-xs text-sidebar-foreground">Profilo</span>
            </span>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 lg:ml-60 flex flex-col min-w-0">
        {/* Mobile header: il logo, la campanella e l'avatar che apre il Profilo. */}
        <header className="lg:hidden flex items-center gap-1 px-4 h-14 border-b border-border bg-card">
          <Link to="/member-portal" className="flex items-center gap-2 mr-auto min-h-11 min-w-0">
            {palestra?.logo_url
              ? <span className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0 overflow-hidden">
                  <img src={palestra.logo_url} alt="" className="w-full h-full object-contain" />
                </span>
              : <Dumbbell className="w-5 h-5 text-primary" aria-hidden="true" />}
            <span className="font-heading font-bold truncate">{nome}</span>
          </Link>
          <Link
            to={PERCORSO_NOTIFICHE}
            aria-label={nonLette > 0 ? `Notifiche, ${nonLette} da vedere` : "Notifiche"}
            aria-current={isActive(PERCORSO_NOTIFICHE) ? "page" : undefined}
            className={`relative w-11 h-11 flex items-center justify-center rounded-lg ${isActive(PERCORSO_NOTIFICHE) ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Bell className="w-5 h-5" aria-hidden="true" />
            <Contatore n={nonLette} className="absolute top-0.5 right-0" />
          </Link>
          <Link
            to={PERCORSO_PROFILO}
            aria-label={`Profilo di ${memberUser.nome}`}
            aria-current={isActive(PERCORSO_PROFILO) ? "page" : undefined}
            className="w-11 h-11 flex items-center justify-center rounded-lg"
          >
            <Avatar nome={memberUser.nome} className={isActive(PERCORSO_PROFILO) ? "ring-2 ring-primary" : ""} />
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {/* Come nel gestionale: cambiando scheda resta la barra in basso, invece di
              sparire tutto per il tempo di caricare la pagina. */}
          <Suspense fallback={<LoadingState minHeight="min-h-[60vh]" label="Caricamento della pagina" />}>
            <Outlet context={{ conteggio, azzeraNonLette: () => setConteggio((c) => ({ ...c, non_lette: 0 })) }} />
          </Suspense>
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
                className={`flex flex-col items-center justify-center gap-1 flex-1 h-full text-xs border-t-2 -mt-px ${
                  attiva ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] leading-none">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
