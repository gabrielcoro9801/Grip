// Il tema si applica **prima** che React parta.
//
// Facendolo dentro l'applicazione, fra il caricamento della pagina e il primo disegno passa
// un istante in cui il fondo è bianco: chi ha scelto il tema scuro si prende una schermata
// chiara in faccia a ogni apertura. Per questo lo si carica nella <head> dei due gusci, senza
// `defer` né `type="module"`: gira prima che la pagina si disegni.
//
// Era scritto dentro i due HTML. Sta in un file perché le pagine ora hanno una Content
// Security Policy che vieta gli script scritti nella pagina (server/src/app.js): è la rete che
// limita i danni di un'iniezione, e un'eccezione per queste righe l'avrebbe bucata.
(function () {
  try {
    var scelta = localStorage.getItem('grip_tema') || 'sistema';
    var scuro =
      scelta === 'scuro' ||
      (scelta === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (scuro) document.documentElement.classList.add('dark');
  } catch (e) {
    // Navigazione privata o cookie bloccati: si resta sul tema chiaro.
  }
})();
