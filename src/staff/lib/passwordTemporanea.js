// La password temporanea che la reception dà al socio per il primo accesso al portale.
//
// Con `Math.random()` non sarebbe imprevedibile: il generatore di V8 si ricostruisce da una
// manciata di valori consecutivi. `crypto.getRandomValues` è disponibile ovunque giri questo
// codice e non ha quel problema. (Prima il file generava anche il seme del codice QR, uscito
// dall'applicazione a novembre 2026.)

// Niente l/1/I/O/0: la password temporanea si detta a voce allo sportello, e quelle coppie
// di caratteri si sbagliano sistematicamente.
const ALFABETO_PASSWORD = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Una password temporanea.
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
