import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
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
import CedoliniPage from '@/pages/personale/CedoliniPage';
import PtLayout from '@/pages/pt/PtLayout';
import PtPortal from '@/pages/pt/PtPortal';
import PtSedutePage from '@/pages/pt/PtSedutePage';
import PtCompensiPage from '@/pages/pt/PtCompensiPage';
import TeamLayout from '@/pages/team/TeamLayout';
import TeamAnagrafica from '@/pages/team/TeamAnagrafica';
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
import Bilancio from '@/pages/accounting/Bilancio';
import FineEsercizio from '@/pages/accounting/FineEsercizio';
import Admin from '@/pages/admin/Admin';
import AuditLogPage from '@/pages/admin/AuditLogPage';
import ProfiloFiscale from '@/pages/settings/ProfiloFiscale';
import ReceiptTemplatePage from '@/pages/admin/ReceiptTemplatePage';
import StaffLogin from '@/pages/StaffLogin';
import { StaffAuthProvider } from '@/lib/StaffAuthContext';
import PermissionGate from '@/components/PermissionGate';

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
        <Route path="ricevute" element={<MemberReceipts />} />
        <Route path="anagrafica" element={<MemberProfile />} />
        <Route path="qr" element={<MemberQR />} />
        <Route path="corsi" element={<MemberCoursesCalendar />} />
        <Route path="allenamento" element={<MemberWorkoutPlans />} />
      </Route>

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
            <Route path="cedolini" element={<CedoliniPage />} />
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
            <Route path="bilancio" element={<Bilancio />} />
            <Route path="fine-esercizio" element={<FineEsercizio />} />
          </Route>
          <Route path="/admin" element={<PermissionGate module="admin_users"><Admin /></PermissionGate>} />
          <Route path="/receipt-template" element={<PermissionGate module="receipt_template"><ReceiptTemplatePage /></PermissionGate>} />
          <Route path="/audit-log" element={<PermissionGate module="audit_log"><AuditLogPage /></PermissionGate>} />
          <Route path="/profilo-fiscale" element={<PermissionGate module="fiscal_profile"><ProfiloFiscale /></PermissionGate>} />
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