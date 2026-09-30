import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

/**
 * Un `href` solo se è un indirizzo web o un percorso del sito; altrimenti niente link.
 *
 * React non blocca gli indirizzi `javascript:`, li segnala solo in console: un indirizzo
 * di file scritto da qualcun altro, messo in un `<a href>`, era codice che girava al clic.
 * Il server ormai li rifiuta in scrittura; questa è la seconda difesa, per le righe salvate prima.
 */
export const hrefSicuro = (u) => (typeof u === "string" && /^(https?:\/\/|\/(?!\/))/i.test(u) ? u : undefined);
