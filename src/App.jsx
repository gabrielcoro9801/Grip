import { lazy, Suspense } from 'react';
import { Toaster } from "@/ui/primitivi/toaster"
import { BrowserRouter as Router, Route, Routes, Navigate, useParams } from 'react-router-dom';
import PageNotFound from '@/ui/PageNotFound';
import ScrollToTop from '@/ui/ScrollToTop';
import { MemberAuthProvider } from '@/member/session/MemberAuthContext';
import { LoadingState } from '@/ui/Spinner';
import ErrorBoundary from '@/ui/ErrorBoundary';
import { TemaProvider } from '@/ui/tema';

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
const StaffShell = lazy(() => import('@/staff/StaffShell'));
// Anche il guardiano dei permessi è caricato su richiesta, non perché sia grosso ma per
// quello che si porta dietro: la matrice dei permessi dello staff. Importato subito, finiva
// nel pacchetto d'ingresso — quello che scarica anche un socio che apre il portale dal
// telefono, e a cui di `admin_users` non importa niente.
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
const MemberLayout = lazy(() => import('@/member/pages/MemberLayout'));
const MemberDashboard = lazy(() => import('@/member/pages/MemberDashboard'));
const MemberDocuments = lazy(() => import('@/member/pages/MemberDocuments'));
const MemberSubscription = lazy(() => import('@/member/pages/MemberSubscription'));
const MemberProfile = lazy(() => import('@/member/pages/MemberProfile'));
const MemberQR = lazy(() => import('@/member/pages/MemberQR'));
const MemberCoursesCalendar = lazy(() => import('@/member/pages/MemberCoursesCalendar'));
const MemberWorkoutPlans = lazy(() => import('@/member/pages/MemberWorkoutPlans'));
const SessioneAllenamento = lazy(() => import('@/member/pages/SessioneAllenamento'));
const Admin = lazy(() => import('@/staff/pages/admin/Admin'));
const AuditLogPage = lazy(() => import('@/staff/pages/admin/AuditLogPage'));

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
  );
};

function App() {
  return (
    // La rete più esterna: un errore dentro una qualsiasi schermata veniva raccolto da
    // nessuno, React smontava tutto e restava una pagina bianca senza spiegazioni.
    <ErrorBoundary>
      <TemaProvider>
        <Router>
          <ScrollToTop />
          <AppRoutes />
        </Router>
        {/* I messaggi in sovrimpressione servono a entrambe le aree, quindi restano qui.
            La sessione dello staff invece è scesa dentro <StaffShell>: avvolgeva anche il
            portale soci, che non ne ha bisogno e non deve scaricarsela. */}
        <Toaster />
      </TemaProvider>
    </ErrorBoundary>
  )
}

export default App