import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * Chiaro, scuro, o come lo vuole il sistema.
 *
 * La palette scura era già scritta per intero — il blocco `.dark` in index.css, e
 * `darkMode: ["class"]` in Tailwind — ma **non c'era niente che aggiungesse quella classe**:
 * codice completo e irraggiungibile. Questo è il pezzo che mancava.
 *
 * Le tre scelte non sono due e mezzo: "sistema" segue le preferenze del telefono e cambia
 * da solo al tramonto se è così che è impostato, mentre chi vuole l'applicazione sempre
 * chiara anche col telefono scuro deve poterlo dire. Sceglierlo per lui, o non offrirlo, è
 * il modo per farsi chiudere l'applicazione da chi si allena in una sala buia.
 */
const CHIAVE = "grip_tema";
const TemaContext = createContext(null);

/** Applica o toglie la classe che accende la palette scura. */
function applica(tema) {
  const scuro =
    tema === "scuro" ||
    (tema === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", scuro);
  return scuro;
}

function leggiPreferenza() {
  try {
    const salvato = localStorage.getItem(CHIAVE);
    return salvato === "chiaro" || salvato === "scuro" || salvato === "sistema" ? salvato : "sistema";
  } catch {
    // In navigazione privata leggere localStorage può sollevare: non è un motivo per non
    // far partire l'applicazione, si riparte dal valore predefinito.
    return "sistema";
  }
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

  // Con "sistema" il tema deve seguire il telefono anche mentre l'applicazione è aperta:
  // senza questo, chi ha il passaggio automatico al tramonto resterebbe sul tema di
  // quando ha aperto la pagina.
  useEffect(() => {
    if (tema !== "sistema") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const aggiorna = () => applica("sistema");
    query.addEventListener("change", aggiorna);
    return () => query.removeEventListener("change", aggiorna);
  }, [tema]);

  const imposta = useCallback((nuovo) => setTema(nuovo), []);

  return <TemaContext.Provider value={{ tema, imposta }}>{children}</TemaContext.Provider>;
}

export function useTema() {
  const contesto = useContext(TemaContext);
  if (!contesto) throw new Error("useTema va usato dentro TemaProvider");
  return contesto;
}
