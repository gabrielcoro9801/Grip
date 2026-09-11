import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { configuraRete } from '@/core/api/client'
import { impostaArchivio } from '@/core/session/archivio'
import { impostaArea, inizializzaSessione } from '@/core/session/sessione'
import { archivioWeb } from '@/ui/platform/archivioWeb'
import '@/index.css'

// Qui si dice a core/ dove si trova: è l'unico punto del programma che lo sa.
//
// core/ non legge indirizzi, non conosce `localStorage` e non sa cosa sia Vite — ed è questo
// che lo rende trasportabile altrove. In cambio va avviato: gli si passa un archivio, un
// indirizzo per il backend e l'area in cui sta girando. Il gemello di questo file per un'app
// su telefono cambierebbe solo queste tre risposte.

// 1. Dove si ricorda il token. Sul web è localStorage.
impostaArchivio(archivioWeb);

// 2. Dove sta il backend. In produzione è lo stesso indirizzo del sito, quindi un percorso
//    relativo; in sviluppo sono due processi su due porte. `import.meta.env` è una cosa di
//    Vite e resta qui fuori.
configuraRete({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : ''),
});

// 3. Quale delle due applicazioni stiamo avviando. Lo decide l'indirizzo, ed è l'unico posto
//    in cui questa domanda ha una risposta certa prima che React parta. Quando il portale
//    avrà un suo punto d'ingresso diventerà una costante scritta in chiaro nei due file
//    d'avvio, e questa riga sparirà.
//    Il confronto ignora le maiuscole perché il router fa lo stesso: `/Member-Portal` apre
//    il portale. Distinguendole, quell'indirizzo avrebbe mostrato il portale usando però la
//    sessione del gestionale — cioè la schermata di accesso a chi era già entrato.
impostaArea(window.location.pathname.toLowerCase().startsWith('/member-portal') ? 'member' : 'staff');

// La sessione si legge dall'archivio **prima** del primo disegno: l'archivio è asincrono, e
// disegnare senza aspettarlo mostrerebbe per un istante la schermata di accesso a chi è già
// connesso. Da qui in poi il token vive in memoria e si legge senza attese.
inizializzaSessione().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
});
