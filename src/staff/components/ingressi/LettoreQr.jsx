import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * La fotocamera del tablet o del PC come lettore QR: quando vede un codice chiama `onCodice` e si
 * ferma, per non leggere lo stesso telefono dieci volte di fila. `jsqr` lavora sui fotogrammi in
 * un canvas, senza dipendere dal BarcodeDetector che Safari e Firefox non hanno.
 *
 * I lettori USB non passano di qui: scrivono nel campo "Codice" come una tastiera.
 */
export default function LettoreQr({ onCodice, onChiudi }) {
  const video = useRef(null);
  const tela = useRef(null);
  const [errore, setErrore] = useState(null);

  useEffect(() => {
    let flusso;
    let ciclo;
    let attivo = true;
    const leggi = () => {
      if (!attivo) return;
      const v = video.current;
      const c = tela.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const trovato = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "dontInvert" });
        if (trovato?.data) {
          attivo = false;
          onCodice(trovato.data);
          return;
        }
      }
      ciclo = setTimeout(leggi, 200);
    };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        flusso = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        leggi();
      })
      .catch(() => setErrore("Fotocamera non disponibile: consenti l'accesso dal browser, oppure usa il lettore o la ricerca per nome."));
    return () => {
      attivo = false;
      clearTimeout(ciclo);
      flusso?.getTracks().forEach((t) => t.stop());
    };
  }, [onCodice]);

  return (
    <div className="space-y-2">
      {errore ? (
        <p className="text-sm text-destructive">{errore}</p>
      ) : (
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-w-md">
          <video ref={video} className="w-full h-full object-cover" muted playsInline aria-label="Inquadra il QR del socio" />
          <div className="absolute inset-8 border-2 border-white/70 rounded-lg pointer-events-none" aria-hidden="true" />
        </div>
      )}
      <canvas ref={tela} className="hidden" aria-hidden="true" />
      <button type="button" onClick={onChiudi} className="text-xs font-medium text-primary hover:underline">Chiudi la fotocamera</button>
    </div>
  );
}
