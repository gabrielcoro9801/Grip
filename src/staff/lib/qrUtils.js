/**
 * Il seme del codice d'accesso e le password temporanee: roba da reception.
 *
 * Il codice che il socio mostra non si costruisce più qui: lo firma il server, che è
 * l'unico ad avere la chiave (vedi shared/qrDinamico.js). Qui resta la generazione del
 * seme permanente, che avviene quando la palestra emette una credenziale.
 *
 * Sta fra gli strumenti del gestionale perché è lì che si usa — il socio un seme non lo
 * genera, se lo vede assegnare. Il disegno dell'immagine, che invece serve a entrambi, sta
 * in `src/ui/qr/qrImmagine.js`.
 */

// Niente I, O, 0, 1: a chi legge il codice a voce alla reception si confondono.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Un seme che non si indovina.
 *
 * Con `Math.random()` non lo era: il generatore di V8 è uno xorshift128+ il cui stato
 * interno si ricostruisce da una manciata di valori consecutivi, quindi chi riusciva a
 * osservarne qualcuno nello stesso contesto poteva prevedere quelli dopo — e questa
 * funzione genera credenziali d'ingresso e password temporanee. `crypto.getRandomValues`
 * è disponibile ovunque giri questo codice e non ha quel problema.
 *
 * L'alfabeto ha 32 lettere e i byte 256 valori: il resto della divisione è distribuito
 * esattamente, senza sbilanciare nessun carattere.
 */
export function generateQRCode() {
  const byte = new Uint8Array(16);
  globalThis.crypto.getRandomValues(byte);
  const segmenti = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) seg += ALFABETO[byte[s * 4 + i] % ALFABETO.length];
    segmenti.push(seg);
  }
  return `GRIP-${segmenti.join("-")}`;
}

// Niente l/1/I/O/0: la password temporanea si detta a voce allo sportello, e quelle coppie
// di caratteri si sbagliano sistematicamente.
const ALFABETO_PASSWORD = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Una password temporanea, dallo stesso generatore e per lo stesso motivo del seme.
 *
 * L'alfabeto ha 31 caratteri, che non divide 256: prendere il resto favorirebbe i primi
 * caratteri dell'alfabeto. La distorsione sarebbe minima, ma su una password si scarta il
 * byte fuori intervallo e si estrae di nuovo, che costa niente e non lascia margini.
 */
export function generaPasswordTemporanea(lunghezza = 10) {
  const massimoUtile = 256 - (256 % ALFABETO_PASSWORD.length);
  let pwd = "";
  while (pwd.length < lunghezza) {
    const byte = new Uint8Array(lunghezza);
    globalThis.crypto.getRandomValues(byte);
    for (const b of byte) {
      if (b >= massimoUtile) continue;
      pwd += ALFABETO_PASSWORD[b % ALFABETO_PASSWORD.length];
      if (pwd.length === lunghezza) break;
    }
  }
  return pwd;
}
