import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/ui/primitivi/toaster';
import PageNotFound from '@/ui/PageNotFound';
import ScrollToTop from '@/ui/ScrollToTop';
import ErrorBoundary from '@/ui/ErrorBoundary';
import { LoadingState } from '@/ui/Spinner';
import { TemaProvider } from '@/ui/tema';
import { MemberAuthProvider } from '@/member/session/MemberAuthContext';

// Il portale soci, e nient'altro.
//
// Prima queste rotte stavano nello stesso file di quelle del gestionale, e quindi nello
// stesso pacchetto: un socio che apriva il portale dal telefono si portava dietro l'indice
// di tutto il gestionale, la sessione dello staff e la matrice dei permessi. Ora sono due
// applicazioni con due punti d'ingresso, e questo file non nomina una sola cosa dell'altra.
//
// I percorsi restano scritti per intero (`/member-portal/...`) invece di usare un `basename`:
// il portale sa già dove sta, e tutti i collegamenti dentro le pagine sono scritti così.
const MemberLayout = lazy(() => import('@/member/pages/MemberLayout'));
const MemberDashboard = lazy(() => import('@/member/pages/MemberDashboard'));
const MemberDocuments = lazy(() => import('@/member/pages/MemberDocuments'));
const MemberSubscription = lazy(() => import('@/member/pages/MemberSubscription'));
const MemberProfile = lazy(() => import('@/member/pages/MemberProfile'));
const MemberQR = lazy(() => import('@/member/pages/MemberQR'));
const MemberCoursesCalendar = lazy(() => import('@/member/pages/MemberCoursesCalendar'));
const MemberWorkoutPlans = lazy(() => import('@/member/pages/MemberWorkoutPlans'));
const SessioneAllenamento = lazy(() => import('@/member/pages/SessioneAllenamento'));

export default function App() {
  return (
    // La rete più esterna: un errore dentro una qualsiasi schermata veniva raccolto da
    // nessuno, React smontava tutto e restava una pagina bianca senza spiegazioni.
    <ErrorBoundary>
      <TemaProvider>
        <Router>
          <ScrollToTop />
          {/* Il riquadro d'attesa copre il momento fra il clic e l'arrivo del pezzo di
              codice. A rete normale non si vede; su quella di una palestra, sì. */}
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

              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Suspense>
          <Toaster />
        </Router>
      </TemaProvider>
    </ErrorBoundary>
  );
}
