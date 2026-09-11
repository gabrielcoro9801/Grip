import App from '@/member/App.jsx';
import { avvia } from '@/ui/platform/avvio';
import '@/index.css';

// Il punto d'ingresso del portale soci: lo carica `member.html`.
//
// È il file che un giorno diventerà il confine con l'app su telefono: là cambierebbe come si
// avvia e come si disegna, ma non cosa c'è dentro `@/member`.
avvia({ area: 'member', App });
