import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { configuraRete, impostaArea, migraSessioneVecchia } from '@/core/api/client'
import '@/index.css'

// Dove sta il backend. In produzione è lo stesso indirizzo del sito, quindi un percorso
// relativo; in sviluppo sono due processi su due porte. La lettura di `import.meta.env` sta
// qui e non dentro core/, perché è una cosa di Vite: core/ deve poter girare anche altrove —
// sotto `node --test`, e un domani su un telefono.
configuraRete({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : ''),
});

// Quale delle due applicazioni stiamo avviando.
//
// Lo decide l'indirizzo, ed è l'unico posto in cui questa domanda ha una risposta certa
// prima che React parta. core/ non può ricavarselo da sé: non sa cosa sia un indirizzo web,
// e su un telefono non ce ne sarebbe uno.
//
// Oggi le due aree convivono in un'unica pagina e questa riga le distingue; quando il
// portale avrà un suo punto d'ingresso diventerà una costante scritta in chiaro, diversa
// nei due file d'avvio. Il resto del codice non se ne accorgerà.
impostaArea(window.location.pathname.startsWith('/member-portal') ? 'member' : 'staff');

// Chi era connesso quando la chiave era una sola non deve accorgersi del cambio.
migraSessioneVecchia();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
