import App from '@/staff/App.jsx';
import { avvia } from '@/ui/platform/avvio';
import '@/index.css';

// Il punto d'ingresso del gestionale: lo carica `index.html`.
avvia({ area: 'staff', App });
