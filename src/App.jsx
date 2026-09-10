import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import CrmLayout from '@/pages/crm/CrmLayout';
import MembersList from '@/pages/crm/MembersList';
import MemberDetail from '@/pages/crm/MemberDetail';
import PlansCatalog from '@/pages/crm/PlansCatalog';
import SubscriptionsList from '@/pages/crm/SubscriptionsList';
import AllenamentoLayout from '@/pages/allenamento/AllenamentoLayout';
import LibreriaEsercizi from '@/pages/allenamento/LibreriaEsercizi';
import SchedeModello from '@/pages/allenamento/SchedeModello';
import SchedeAssegnate from '@/pages/allenamento/SchedeAssegnate';
import AllenamentiSvolti from '@/pages/allenamento/AllenamentiSvolti';
import EditorScheda from '@/pages/allenamento/EditorScheda';
import CalendarPage from '@/pages/CalendarPage';
import { MemberAuthProvider } from '@/lib/MemberAuthContext';
import MemberLayout from '@/pages/member/MemberLayout';
import MemberDashboard from '@/pages/member/MemberDashboard';
import MemberDocuments from '@/pages/member/MemberDocuments';
import MemberSubscription from '@/pages/member/MemberSubscription';
import MemberProfile from '@/pages/member/MemberProfile';
import MemberQR from '@/pages/member/MemberQR';
import MemberCoursesCalendar from '@/pages/member/MemberCoursesCalendar';
import MemberWorkoutPlans from '@/pages/member/MemberWorkoutPlans';
import SessioneAllenamento from '@/pages/member/SessioneAllenamento';
import Admin from '@/pages/admin/Admin';
import AuditLogPage from '@/pages/admin/AuditLogPage';
import StaffLogin from '@/pages/StaffLogin';
import { StaffAuthProvider } from '@/lib/StaffAuthContext';
import PermissionGate from '@/components/PermissionGate';

// Il vecchio /crm/members/:id porta alla stessa scheda del socio: il redirect
// deve portarsi dietro l'id, altrimenti un link salvato finisce sull'elenco.
const RedirectSocio = () => {
  const { id } = useParams();
  return <Navigate to={`/crm/soci/${id}`} replace />;
};

// Due aree con accessi indipendenti: il gestionale (AppLayout mostra StaffLogin
// finché non c'è una sessione staff) e il portale soci (MemberLayout mostra
// MemberLogin allo stesso modo).
const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/member-portal" element={<MemberAuthProvider><MemberLayout /></MemberAuthProvider>}>
        <Route index element={<MemberDashboard />} />
        <Route path="documenti" element={<MemberDocuments />} />
        <Route path="abbonamento" element={<MemberSubscription />} />
        <Route path="anagrafica" element={<MemberProfile />} />
        <Route path="qr" element={<MemberQR />} />
        <Route path="corsi" element={<MemberCoursesCalendar />} />
        <Route path="allenamento" element={<MemberWorkoutPlans />} />
        {/* L'allenamento mentre lo si fa: a schermo intero, senza le barre del
            portale — MemberLayout le toglie su questo percorso. */}
        <Route path="allenamento/sessione/:id" element={<SessioneAllenamento />} />
      </Route>

      <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          {/* Gli slug del gestionale sono in italiano come le voci che li
              nominano. I vecchi percorsi in inglese restano come redirect,
              perché possono essere nei preferiti. */}
          <Route path="/crm" element={<PermissionGate module="crm_members"><CrmLayout /></PermissionGate>}>
            <Route index element={<MembersList />} />
            <Route path="soci/:id" element={<MemberDetail />} />
            <Route path="abbonamenti" element={<PlansCatalog />} />
            <Route path="iscrizioni" element={<SubscriptionsList />} />
            <Route path="members/:id" element={<RedirectSocio />} />
            <Route path="plans" element={<Navigate to="/crm/abbonamenti" replace />} />
            <Route path="subscriptions" element={<Navigate to="/crm/iscrizioni" replace />} />
            {/* L'allenamento è uscito dai Soci ed è una sezione sua. I due vecchi
                percorsi restano come redirect: possono essere nei preferiti. */}
            <Route path="piani-allenamento" element={<Navigate to="/allenamento/assegnate" replace />} />
            <Route path="exercise-plans" element={<Navigate to="/allenamento/assegnate" replace />} />
          </Route>
          <Route path="/allenamento" element={<PermissionGate module="crm_plans"><AllenamentoLayout /></PermissionGate>}>
            <Route index element={<LibreriaEsercizi />} />
            <Route path="modelli" element={<SchedeModello />} />
            <Route path="assegnate" element={<SchedeAssegnate />} />
            <Route path="svolti" element={<AllenamentiSvolti />} />
            {/* L'editor di una scheda: comporre righe di serie non sta in una finestra
                di dialogo, e un percorso proprio rende la scheda un indirizzo che si
                può mandare a un collega. */}
            <Route path="schede/:id" element={<EditorScheda />} />
          </Route>
          <Route path="/calendario" element={<PermissionGate module="calendar"><CalendarPage /></PermissionGate>} />
          <Route path="/calendar" element={<Navigate to="/calendario" replace />} />
          <Route path="/admin" element={<PermissionGate module="admin_users"><Admin /></PermissionGate>} />
          <Route path="/log-audit" element={<PermissionGate module="audit_log"><AuditLogPage /></PermissionGate>} />
          <Route path="/audit-log" element={<Navigate to="/log-audit" replace />} />
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <StaffAuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </StaffAuthProvider>
  )
}

export default App