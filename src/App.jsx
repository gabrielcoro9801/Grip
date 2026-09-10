import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import { MemberAuthProvider } from '@/lib/MemberAuthContext';
import { StaffAuthProvider } from '@/lib/StaffAuthContext';
import PermissionGate from '@/components/PermissionGate';
import { LoadingState } from '@/components/shared/Spinner';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { TemaProvider } from '@/lib/tema';

// Ogni pagina è caricata quando la si apre, non prima.
//
// L'applicazione è una sola, ma le persone che la usano sono due: il socio che apre il
// portale dal telefono si scaricava anche tutto il gestionale — anagrafiche, calendario,
// amministrazione, l'editor delle schede — cioè la maggior parte di un pacchetto da
// 750 kB per usarne una fetta. Con `lazy` il codice si divide da sé lungo le rotte: chi
// entra in `/member-portal` prende il portale, chi entra in `/crm` prende il gestionale, e
// nessuno dei due porta con sé l'altro.
//
// Restano caricate subito solo le cose che servono comunque a decidere dove andare: il
// router, i due contesti di autenticazione e la pagina "non trovato".
const AppLayout = lazy(() => import('@/components/layout/AppLayout'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const CrmLayout = lazy(() => import('@/pages/crm/CrmLayout'));
const MembersList = lazy(() => import('@/pages/crm/MembersList'));
const MemberDetail = lazy(() => import('@/pages/crm/MemberDetail'));
const PlansCatalog = lazy(() => import('@/pages/crm/PlansCatalog'));
const SubscriptionsList = lazy(() => import('@/pages/crm/SubscriptionsList'));
const AllenamentoLayout = lazy(() => import('@/pages/allenamento/AllenamentoLayout'));
const LibreriaEsercizi = lazy(() => import('@/pages/allenamento/LibreriaEsercizi'));
const SchedeModello = lazy(() => import('@/pages/allenamento/SchedeModello'));
const SchedeAssegnate = lazy(() => import('@/pages/allenamento/SchedeAssegnate'));
const AllenamentiSvolti = lazy(() => import('@/pages/allenamento/AllenamentiSvolti'));
const EditorScheda = lazy(() => import('@/pages/allenamento/EditorScheda'));
const CalendarPage = lazy(() => import('@/pages/CalendarPage'));
const MemberLayout = lazy(() => import('@/pages/member/MemberLayout'));
const MemberDashboard = lazy(() => import('@/pages/member/MemberDashboard'));
const MemberDocuments = lazy(() => import('@/pages/member/MemberDocuments'));
const MemberSubscription = lazy(() => import('@/pages/member/MemberSubscription'));
const MemberProfile = lazy(() => import('@/pages/member/MemberProfile'));
const MemberQR = lazy(() => import('@/pages/member/MemberQR'));
const MemberCoursesCalendar = lazy(() => import('@/pages/member/MemberCoursesCalendar'));
const MemberWorkoutPlans = lazy(() => import('@/pages/member/MemberWorkoutPlans'));
const SessioneAllenamento = lazy(() => import('@/pages/member/SessioneAllenamento'));
const Admin = lazy(() => import('@/pages/admin/Admin'));
const AuditLogPage = lazy(() => import('@/pages/admin/AuditLogPage'));

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
    // Il riquadro d'attesa copre il momento fra il clic e l'arrivo del pezzo di codice.
    // A rete normale non si vede: i file sono piccoli e stanno nella cache del browser
    // dalla seconda volta in poi.
    <Suspense fallback={<LoadingState minHeight="min-h-screen" label="Caricamento della pagina" />}>
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
    </Suspense>
  );
};

function App() {
  return (
    // La rete più esterna: un errore dentro una qualsiasi schermata veniva raccolto da
    // nessuno, React smontava tutto e restava una pagina bianca senza spiegazioni.
    <ErrorBoundary>
      <TemaProvider>
      <StaffAuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <AppRoutes />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </StaffAuthProvider>
      </TemaProvider>
    </ErrorBoundary>
  )
}

export default App