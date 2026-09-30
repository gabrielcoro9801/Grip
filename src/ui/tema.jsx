import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * Chiaro o scuro.
 *
 * La palette scura era già scritta per intero — il blocco `.dark` in index.css, e
 * `darkMode: ["class"]` in Tailwind — ma **non c'era niente che aggiungesse quella classe**:
 * codice completo e irraggiungibile. Questo è il pezzo che mancava.
 *
 * Le scelte sono due, e si cambiano con l'interruttore accanto al nome dell'applicazione.
 * C'era una terza, "come il sistema": è stata tolta. Chi non ha mai scelto parte da quello
 * che dice il sistema al primo avvio, e da lì in poi comanda l'interruttore.
 */
const CHIAVE = "grip_tema";
const TemaContext = createContext(null);

/** Applica o toglie la classe che accende la palette scura. */
function applica(tema) {
  document.documentElement.classList.toggle("dark", tema === "scuro");
}

function sistemaScuro() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function leggiPreferenza() {
  try {
    const salvato = localStorage.getItem(CHIAVE);
    if (salvato === "chiaro" || salvato === "scuro") return salvato;
  } catch {
    // In navigazione privata leggere localStorage può sollevare: non è un motivo per non
    // far partire l'applicazione, si riparte da quello che dice il sistema.
  }
  // Mai scelto, o scelto "come il sistema" quando la terza scelta c'era ancora.
  return sistemaScuro() ? "scuro" : "chiaro";
}

export function TemaProvider({ children }) {
  const [tema, setTema] = useState(leggiPreferenza);

  useEffect(() => {
    applica(tema);
    try {
      localStorage.setItem(CHIAVE, tema);
    } catch {
      // Se non si può salvare, la scelta vale per questa sessione. Meglio di un errore.
    }
  }, [tema]);

  const imposta = useCallback((nuovo) => setTema(nuovo === "scuro" ? "scuro" : "chiaro"), []);

  return <TemaContext.Provider value={{ tema, imposta }}>{children}</TemaContext.Provider>;
}

export function useTema() {
  const contesto = useContext(TemaContext);
  if (!contesto) throw new Error("useTema va usato dentro TemaProvider");
  return contesto;
}
