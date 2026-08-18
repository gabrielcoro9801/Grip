/**
 * Utilities per la generazione e visualizzazione dei QR di accesso.
 */

/** Genera un codice univoco non indovinabile (es. GRIP-A8X2-K9F3-M2Q7) */
export function generateQRCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return `GRIP-${segments.join("-")}`;
}

/** Restituisce l'URL dell'immagine QR da api.qrserver.com */
export function getQRImageUrl(code, size = 300) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(code)}&bgcolor=ffffff&color=000000&margin=10`;
}