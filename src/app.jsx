import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import CrmLayout from '@/pages/crm/CrmLayout';
import MembersList from '@/pages/crm/MembersList';
import MemberDetail from '@/pages/crm/MemberDetail';
import PlansCatalog from '@/pages/crm/PlansCatalog';
import SubscriptionsList from '@/pages/crm/SubscriptionsList';
import ReceiptsList from '@/pages/crm/ReceiptsList';
import ExercisePlans from '@/pages/crm/ExercisePlans';
import ClientsList from '@/pages/crm/ClientsList';
import PersonaleLayout from '@/pages/personale/PersonaleLayout';
import PersonalePortal from '@/pages/personale/PersonalePortal';
import TimbraturaPage from '@/pages/personale/TimbraturaPage';
import TurniPage from '@/pages/personale/TurniPage';
import FeriePermessiPage from '@/pages/personale/FeriePermessiPage';
import PresenzeExportPage from '@/pages/personale/PresenzeExportPage';
import PtLayout from '@/pages/pt/PtLayout';
import PtPortal from '@/pages/pt/PtPortal';
import PtSedutePage from '@/pages/pt/PtSedutePage';
import PtCompensiPage from '@/pages/pt/PtCompensiPage';
import TeamLayout from '@/pages/team/TeamLayout';
import TeamAnagrafica from '@/pages/team/TeamAnagrafica';
import Finance from '@/pages/Finance';
import CalendarPage from '@/pages/CalendarPage';
import { MemberAuthProvider } from '@/lib/MemberAuthContext';
import MemberLayout from '@/pages/member/MemberLayout';
import MemberDashboard from '@/pages/member/MemberDashboard';
import MemberDocuments from '@/pages/member/MemberDocuments';
import MemberSubscription from '@/pages/member/MemberSubscription';
import MemberReceipts from '@/pages/member/MemberReceipts';
import MemberProfile from '@/pages/member/MemberProfile';
import MemberQR from '@/pages/member/MemberQR';
import MemberCoursesCalendar from '@/pages/member/MemberCoursesCalendar';
import MemberWorkoutPlans from '@/pages/member/MemberWorkoutPlans';
import AccountingLayout from '@/pages/accounting/AccountingLayout';
import ChartOfAccounts from '@/pages/accounting/ChartOfAccounts';
import NewJournalEntry from '@/pages/accounting/NewJournalEntry';
import Movimenti from '@/pages/accounting/Movimenti';
import CausaliOperative from '@/pages/accounting/CausaliOperative';
import Finanziamenti from '@/pages/accounting/Finanziamenti';
import Admin from '@/pages/admin/Admin';
import AuditLogPage from '@/pages/admin/AuditLogPage';
import ProfiloFiscale from '@/pages/settings/ProfiloFiscale';
import ReceiptTemplatePage from '@/pages/admin/ReceiptTemplatePage';
import StaffLogin from '@/pages/StaffLogin';
import { StaffAuthProvider } from '@/lib/StaffAuthContext';
import PermissionGate from '@/components/PermissionGate';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/member-portal" element={<MemberAuthProvider><MemberLayout /></MemberAuthProvider>}>
        <Route index element={<MemberDashboard />} />
        <Route path="documenti" element={<MemberDocuments />} />
        <Route path="abbonamento" element={<MemberSubscription />} />
        <Route path="ricevute" element={<MemberReceipts />} />
        <Route path="anagrafica" element={<MemberProfile />} />
        <Route path="qr" element={<MemberQR />} />
        <Route path="corsi" element={<MemberCoursesCalendar />} />
        <Route path="allenamento" element={<MemberWorkoutPlans />} />
      </Route>

      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/crm" element={<PermissionGate module="crm_members"><CrmLayout /></PermissionGate>}>
            <Route index element={<MembersList />} />
            <Route path="members/:id" element={<MemberDetail />} />
            <Route path="plans" element={<PlansCatalog />} />
            <Route path="subscriptions" element={<SubscriptionsList />} />
            <Route path="receipts" element={<ReceiptsList />} />
            <Route path="exercise-plans" element={<ExercisePlans />} />
          </Route>
          <Route path="/movimenti" element={<PermissionGate module="movimenti"><Movimenti /></PermissionGate>} />
          <Route path="/acquisti" element={<Navigate to="/movimenti" replace />} />
          <Route path="/vendite" element={<PermissionGate module="vendite"><ClientsList /></PermissionGate>} />
          <Route path="/crediti-debiti" element={<Navigate to="/movimenti" replace />} />
          <Route path="/finance" element={<Navigate to="/movimenti" replace />} />
          <Route path="/calendar" element={<PermissionGate module="calendar"><CalendarPage /></PermissionGate>} />
          <Route path="/personale" element={<PermissionGate module="personale"><PersonaleLayout /></PermissionGate>}>
            <Route index element={<PersonalePortal />} />
            <Route path="timbratura" element={<TimbraturaPage />} />
            <Route path="turni" element={<TurniPage />} />
            <Route path="ferie" element={<FeriePermessiPage />} />
            <Route path="presenze" element={<PresenzeExportPage />} />
          </Route>
          <Route path="/pt" element={<PermissionGate module="pt_esterni"><PtLayout /></PermissionGate>}>
            <Route index element={<PtPortal />} />
            <Route path="sedute" element={<PtSedutePage />} />
            <Route path="compensi" element={<PtCompensiPage />} />
          </Route>
          <Route path="/team" element={<PermissionGate module="team"><TeamLayout /></PermissionGate>}>
            <Route index element={<TeamAnagrafica />} />
            <Route path="compensi" element={<PtCompensiPage />} />
            <Route path="sedute" element={<PtSedutePage />} />
            <Route path="timbratura" element={<TimbraturaPage />} />
            <Route path="turni" element={<TurniPage />} />
            <Route path="ferie" element={<FeriePermessiPage />} />
          </Route>
          <Route path="/contabilita" element={<PermissionGate module="finance"><AccountingLayout /></PermissionGate>}>
            <Route index element={<ChartOfAccounts />} />
            <Route path="prima-nota" element={<Navigate to="/movimenti" replace />} />
            <Route path="nuova-registrazione" element={<NewJournalEntry />} />
            <Route path="causali" element={<CausaliOperative />} />
            <Route path="finanziamenti" element={<Finanziamenti />} />
          </Route>
          <Route path="/admin" element={<PermissionGate module="admin_users"><Admin /></PermissionGate>} />
          <Route path="/receipt-template" element={<PermissionGate module="receipt_template"><ReceiptTemplatePage /></PermissionGate>} />
          <Route path="/audit-log" element={<PermissionGate module="audit_log"><AuditLogPage /></PermissionGate>} />
          <Route path="/profilo-fiscale" element={<PermissionGate module="fiscal_profile"><ProfiloFiscale /></PermissionGate>} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <StaffAuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </StaffAuthProvider>
    </AuthProvider>
  )
}

export default App