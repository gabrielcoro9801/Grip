import React from "react";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { linkWhatsApp, normalizzaTelefono } from "@/core/domain/anagrafica";
import { Phone, MessageCircle, MessageSquare, Mail, Copy } from "lucide-react";

/** Un recapito in chiaro, con «Copia»: niente link, lo si incolla dove serve. */
function Recapito({ icona: Icona, etichetta, valore, mancante, copiato }) {
  const { toast } = useToast();
  const copia = async () => {
    try {
      await navigator.clipboard.writeText(valore);
      toast({ title: copiato });
    } catch {
      toast({ title: "Non copiato", description: "Il browser non lascia copiare: selezionalo a mano.", variant: "destructive" });
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <Icona className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{etichetta}</p>
        <p className={`text-sm break-all ${valore ? "font-medium select-all" : "text-muted-foreground"}`}>{valore || mancante}</p>
      </div>
      {valore && (
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={copia} aria-label={`Copia ${etichetta.toLowerCase()}`}>
          <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copia
        </Button>
      )}
    </div>
  );
}

/**
 * "Contatta": i recapiti di un socio e un pulsante per ogni app — telefono, WhatsApp, SMS,
 * email. Sono link: si apre l'app del telefono o del computer, e GRIP non registra niente (il
 * "fatto" si segna in Da fare, se c'era qualcosa da fare). Un recapito che manca spegne il suo
 * pulsante, e lo dice.
 *
 * Con `soloRecapiti` (Da fare) niente link: telefono ed email in chiaro, ognuno con «Copia», e
 * un recapito che manca dice «Nessun telefono» o «Nessuna email».
 *
 * @param socio { nome, telefono, email } o null (chiuso)
 */
export default function Contatta({ socio, onChiudi, soloRecapiti = false }) {
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
        {socio && soloRecapiti && (
          <>
            <DialogHeader>
              <DialogTitle>Recapiti di {socio.nome}</DialogTitle>
              <DialogDescription>Telefono ed email, da copiare dove servono.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Recapito icona={Phone} etichetta="Telefono" valore={telefono} mancante="Nessun telefono" copiato="Telefono copiato" />
              <Recapito icona={Mail} etichetta="Email" valore={socio.email ?? ""} mancante="Nessuna email" copiato="Email copiata" />
            </div>
          </>
        )}
        {socio && !soloRecapiti && (
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
