import { indirizzoApi, intestazioniAutenticazione } from "@/core/api/client";

/**
 * Il caricamento di un file.
 *
 * Sta fra gli strumenti del gestionale e non nel client generale per un motivo che si vede
 * a occhio nel codice: `FormData` è un oggetto del browser, e core/ deve poter girare dove
 * il browser non c'è. Ed è anche l'unico posto giusto a guardare chi lo usa — al socio il
 * server risponde 403 sugli upload (`server/src/routes/uploads.js`), quindi questa funzione
 * non avrebbe mai ragione di partire dal portale.
 *
 * Stessa firma e stessa forma di risposta ({ file_url }) di prima.
 */
export async function caricaFile({ file }) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${indirizzoApi()}/api/uploads`, {
    method: "POST",
    // niente Content-Type: lo imposta il browser, col suo separatore
    headers: intestazioniAutenticazione(),
    body: form,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Upload fallito (HTTP ${res.status})`);
  }
  return res.json();
}
