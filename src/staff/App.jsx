import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import { Toaster } from '@/ui/primitivi/toaster';
import PageNotFound from '@/ui/PageNotFound';
import ScrollToTop from '@/ui/ScrollToTop';
import ErrorBoundary from '@/ui/ErrorBoundary';
import { LoadingState } from '@/ui/Spinner';
import { TemaProvider } from '@/ui/tema';

// Il gestionale, e nient'altro: il portale soci è un'altra applicazione, con un altro punto
// d'ingresso (`member.html`). Qui non compare.
//
// Ogni pagina è caricata quando la si apre, non prima: le sezioni sono molte e chi lavora in
// reception non ha ragione di scaricarsi l'editor delle schede.
const StaffShell = lazy(() => import('@/staff/StaffShell'));
const PermissionGate = lazy(() => import('@/staff/components/PermissionGate'));
const Dashboard = lazy(() => import('@/staff/pages/Dashboard'));
const CrmLayout = lazy(() => import('@/staff/pages/crm/CrmLayout'));
const MembersList = lazy(() => import('@/staff/pages/crm/MembersList'));
const MemberDetail = lazy(() => import('@/staff/pages/crm/MemberDetail'));
const PlansCatalog = lazy(() => import('@/staff/pages/crm/PlansCatalog'));
const SubscriptionsList = lazy(() => import('@/staff/pages/crm/SubscriptionsList'));
const AllenamentoLayout = lazy(() => import('@/staff/pages/allenamento/AllenamentoLayout'));
const LibreriaEsercizi = lazy(() => import('@/staff/pages/allenamento/LibreriaEsercizi'));
const SchedeModello = lazy(() => import('@/staff/pages/allenamento/SchedeModello'));
const SchedeAssegnate = lazy(() => import('@/staff/pages/allenamento/SchedeAssegnate'));
const AllenamentiSvolti = lazy(() => import('@/staff/pages/allenamento/AllenamentiSvolti'));
const EditorScheda = lazy(() => import('@/staff/pages/allenamento/EditorScheda'));
const CorsiLayout = lazy(() => import('@/staff/pages/corsi/CorsiLayout'));
const Calendario = lazy(() => import('@/staff/pages/corsi/Calendario'));
const Prenotazioni = lazy(() => import('@/staff/pages/corsi/Prenotazioni'));
const CatalogoCorsi = lazy(() => import('@/staff/pages/corsi/CatalogoCorsi'));
const Sale = lazy(() => import('@/staff/pages/corsi/Sale'));
const Istruttori = lazy(() => import('@/staff/pages/corsi/Istruttori'));
const Categorie = lazy(() => import('@/staff/pages/corsi/Categorie'));
const Admin = lazy(() => import('@/staff/pages/admin/Admin'));
const AuditLogPage = lazy(() => import('@/staff/pages/admin/AuditLogPage'));

// Il vecchio /crm/members/:id porta alla stessa scheda del socio: il redirect
// deve portarsi dietro l'id, altrimenti un link salvato finisce sull'elenco.
const RedirectSocio = () => {
  const { id } = useParams();
  return <Navigate to={`/crm/soci/${id}`} replace />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <TemaProvider>
        <Router>
          <ScrollToTop />
          <Suspense fallback={<LoadingState minHeight="min-h-screen" label="Caricamento della pagina" />}>
            <Routes>
              <Route element={<StaffShell />}>
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
                {/* I corsi erano una pagina sola con due piani di schede interne. Ora le sei viste
                    sono rotte come nelle altre sezioni: la barra in alto è la stessa di Soci e
                    Allenamento, e ogni voce ha un indirizzo che si può mandare a un collega. */}
                <Route path="/calendario" element={<PermissionGate module="calendar"><CorsiLayout /></PermissionGate>}>
                  <Route index element={<Calendario />} />
                  <Route path="prenotazioni" element={<Prenotazioni />} />
                  <Route path="corsi" element={<CatalogoCorsi />} />
                  <Route path="sale" element={<Sale />} />
                  <Route path="istruttori" element={<Istruttori />} />
                  <Route path="categorie" element={<Categorie />} />
                </Route>
                <Route path="/calendar" element={<Navigate to="/calendario" replace />} />
                <Route path="/admin" element={<PermissionGate module="admin_users"><Admin /></PermissionGate>} />
                <Route path="/log-audit" element={<PermissionGate module="audit_log"><AuditLogPage /></PermissionGate>} />
                <Route path="/audit-log" element={<Navigate to="/log-audit" replace />} />
              </Route>

              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Suspense>
          <Toaster />
        </Router>
      </TemaProvider>
    </ErrorBoundary>
  );
}
