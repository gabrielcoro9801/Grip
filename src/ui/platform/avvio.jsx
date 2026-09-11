import React from 'react';
import ReactDOM from 'react-dom/client';
import { configuraRete } from '@/core/api/client';
import { impostaArchivio } from '@/core/session/archivio';
import { impostaArea, inizializzaSessione } from '@/core/session/sessione';
import { archivioWeb } from '@/ui/platform/archivioWeb';

/**
 * L'avvio di un'applicazione web di Grip.
 *
 * core/ non sa dove si trova: non legge indirizzi, non conosce `localStorage`, non sa cosa
 * sia Vite — ed è questo che lo rende trasportabile altrove. In cambio va avviato, e qui si
 * risponde alle tre domande che si fa: dove ricordare la sessione, dove sta il backend, e
 * quale delle due applicazioni è questa.
 *
 * Il gemello di questo file per un'app su telefono cambierebbe solo quelle tre risposte.
 *
 * Sta in un punto solo, e non copiato nei due punti d'ingresso, perché è la parte che deve
 * restare identica: due copie divergono, e la prima a divergere sarebbe quella che nessuno
 * apre in sviluppo.
 */
export function avvia({ area, App }) {
  // 1. Dove si ricorda il token. Sul web è localStorage.
  impostaArchivio(archivioWeb);

  // 2. Dove sta il backend. In produzione è lo stesso indirizzo del sito, quindi un percorso
  //    relativo; in sviluppo sono due processi su due porte. `import.meta.env` è una cosa di
  //    Vite e resta fuori da core/.
  configuraRete({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : ''),
  });

  // 3. Quale applicazione. Non si deduce più dall'indirizzo: la dice il punto d'ingresso,
  //    che è l'unico a saperlo per certo.
  impostaArea(area);

  // La sessione si legge dall'archivio **prima** del primo disegno: l'archivio è asincrono, e
  // disegnare senza aspettarlo mostrerebbe per un istante la schermata di accesso a chi è già
  // connesso. Da qui in poi il token vive in memoria e si legge senza attese.
  //
  // `finally` e non `then`: se l'archivio è inaccessibile — navigazione privata, cookie
  // bloccati — l'applicazione parte comunque, senza sessione. Una pagina bianca sarebbe una
  // reazione peggiore del problema.
  inizializzaSessione().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  });
}
