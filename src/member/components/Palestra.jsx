import React, { useEffect, useState } from "react";
import { caricaPalestra } from "@/core/api/portale";
import { Button } from "@/ui/primitivi/button";
import { linkWhatsApp, normalizzaTelefono } from "@/core/domain/anagrafica";
import { Phone, MessageCircle, Mail, MapPin, Clock } from "lucide-react";

// I recapiti della palestra (li scrive l'amministratore in Contatti): in Abbonamento per
// rinnovare, in Profilo per i dati sbagliati. Un campo vuoto non si mostra.

/** I contatti, o null finché non arrivano (e se non arrivano: la pagina resta utile senza). */
export function usePalestra() {
  const [palestra, setPalestra] = useState(null);
  useEffect(() => {
    let attivo = true;
    caricaPalestra().then((p) => { if (attivo) setPalestra(p); }).catch(() => {});
    return () => { attivo = false; };
  }, []);
  return palestra;
}

const mappa = (indirizzo) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(indirizzo)}`;

/** «Chiama» e «WhatsApp», affiancati; niente se mancano entrambi. */
export function PulsantiContatto({ palestra }) {
  const tel = normalizzaTelefono(palestra?.telefono);
  const wa = linkWhatsApp(palestra?.whatsapp);
  if (!tel && !wa) return null;
  return (
    <div className="flex gap-2">
      {tel && (
        <Button asChild variant="outline" className="flex-1 min-h-11">
          <a href={`tel:${tel}`}><Phone className="w-4 h-4" aria-hidden="true" /> Chiama</a>
        </Button>
      )}
      {wa && (
        <Button asChild variant="outline" className="flex-1 min-h-11">
          <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-4 h-4" aria-hidden="true" /> WhatsApp</a>
        </Button>
      )}
    </div>
  );
}

/** Gli orari della reception, se ci sono. */
export function OrariReception({ palestra, className = "" }) {
  if (!palestra?.orari) return null;
  return (
    <p className={`flex items-start gap-2 text-sm text-muted-foreground whitespace-pre-line ${className}`}>
      <Clock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>Reception: {palestra.orari}</span>
    </p>
  );
}

/** La palestra per intero: indirizzo (apre Google Maps), telefono, WhatsApp, email, orari. */
export function RecapitiPalestra({ palestra }) {
  if (!palestra) return null;
  const tel = normalizzaTelefono(palestra.telefono);
  const wa = linkWhatsApp(palestra.whatsapp);
  const righe = [
    palestra.indirizzo && { icona: MapPin, testo: palestra.indirizzo, href: mappa(palestra.indirizzo), esterno: true, etichetta: "Indirizzo" },
    tel && { icona: Phone, testo: palestra.telefono, href: `tel:${tel}`, etichetta: "Telefono" },
    wa && { icona: MessageCircle, testo: palestra.whatsapp, href: wa, esterno: true, etichetta: "WhatsApp" },
    palestra.email && { icona: Mail, testo: palestra.email, href: `mailto:${palestra.email}`, etichetta: "Email" },
  ].filter(Boolean);
  if (!righe.length && !palestra.orari) return null;
  return (
    <div className="space-y-1">
      {righe.map((r) => (
        <a
          key={r.etichetta}
          href={r.href}
          {...(r.esterno ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="flex items-center gap-3 py-2 min-h-11 rounded-md hover:bg-muted/50"
        >
          <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <r.icona className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{r.etichetta}</span>
            <span className="block text-sm font-medium text-primary break-words">{r.testo}</span>
          </span>
        </a>
      ))}
      <OrariReception palestra={palestra} className="pt-1" />
    </div>
  );
}
