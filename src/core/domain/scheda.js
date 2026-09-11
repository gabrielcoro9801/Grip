// Il modello di dominio dell'allenamento vive in `shared/`, non qui.
//
// Il motivo è che ora serve a entrambi i lati: le pagine lo usano per disegnare una scheda
// e contare le serie, e il server lo usa per calcolare record e statistiche prima di
// mandarli al portale (`server/src/routes/member/`). Averne due copie avrebbe significato
// due definizioni di "quanto ho sollevato questa settimana" che prima o poi divergono, e la
// divergenza non darebbe errore: darebbe due numeri diversi nella stessa schermata.
//
// Questo file resta come porta d'ingresso perché `@/core/domain/scheda` è l'indirizzo che
// undici file usano già, ed è lo stesso schema di `gruppiMuscolari`.
export * from '../../../shared/scheda.js';
