/**
 * Il QR come immagine, disegnata nel browser.
 *
 * Prima l'immagine arrivava da `api.qrserver.com`, con il codice nella query string: ogni
 * volta che un socio apriva la schermata, la sua credenziale d'ingresso finiva nei log di
 * un servizio esterno e di qualunque intermediario vedesse l'indirizzo. Ora non esce dal
 * dispositivo.
 *
 * Sta in ui/ e non in core/ per un motivo preciso: `QRCode.toDataURL` disegna su un canvas,
 * cioè su un pezzo di DOM. È l'unica parte del codice d'accesso che un'app su telefono
 * dovrà rifare (là si usa una libreria che disegna in SVG nativo). Tutto il resto — la
 * finestra di un minuto, il codice firmato dal server — è già portabile e vive altrove:
 * l'aritmetica in `shared/qrDinamico.js`, la firma sul server.
 */
import QRCode from "qrcode";

export async function qrDataUrl(codice, dimensione = 300) {
  if (!codice) return null;
  return QRCode.toDataURL(codice, {
    width: dimensione,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}
