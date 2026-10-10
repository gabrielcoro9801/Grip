import React from "react";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { linkWhatsApp, normalizzaTelefono } from "@/core/domain/anagrafica";
import { Phone, MessageCircle, MessageSquare, Mail } from "lucide-react";

/**
 * "Contatta": i recapiti di un socio e un pulsante per ogni app — telefono, WhatsApp, SMS,
 * email. Sono link: si apre l'app del telefono o del computer, e GRIP non registra niente (il
 * "fatto" si segna in Da fare, se c'era qualcosa da fare). Un recapito che manca spegne il suo
 * pulsante, e lo dice.
 *
 * @param socio { nome, telefono, email } o null (chiuso)
 */
export default function Contatta({ socio, onChiudi }) {
  const telefono = socio?.telefono ?? "";
  const numero = normalizzaTelefono(telefono);
  const whatsapp = socio ? linkWhatsApp(telefono, `Ciao ${String(socio.nome ?? "").split(" ")[0]}!`) : null;
  const voci = socio ? [
    { etichetta: "Chiama", icona: Phone, href: numero ? `tel:${numero}` : null },
    { etichetta: "WhatsApp", icona: MessageCircle, href: whatsapp, esterno: true },
    { etichetta: "SMS", icona: MessageSquare, href: numero ? `sms:${numero}` : null },
    { etichetta: "Email", icona: Mail, href: socio.email ? `mailto:${socio.email}` : null },
  ] : [];

  return (
    <Dialog open={!!socio} onOpenChange={(v) => { if (!v) onChiudi(); }}>
      <DialogContent className="max-w-sm">
        {socio && (
          <>
            <DialogHeader>
              <DialogTitle>Contatta {socio.nome}</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-0.5">
                  <p>{telefono || "Nessun telefono"}</p>
                  <p className="break-all">{socio.email || "Nessuna email"}</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {voci.map((v) => (v.href ? (
                <Button key={v.etichetta} asChild variant="outline" className="h-14 flex-col gap-1">
                  <a href={v.href} {...(v.esterno ? { target: "_blank", rel: "noreferrer" } : {})}>
                    <v.icona className="w-5 h-5" aria-hidden="true" />{v.etichetta}
                  </a>
                </Button>
              ) : (
                <Button key={v.etichetta} variant="outline" className="h-14 flex-col gap-1" disabled title={v.etichetta === "Email" ? "Manca l'email" : "Manca il telefono"}>
                  <v.icona className="w-5 h-5" aria-hidden="true" />{v.etichetta}
                </Button>
              )))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
