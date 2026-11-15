import React, { useEffect, useState } from "react";
import { caricaConsensi, revocaConsenso } from "@/core/api/portale";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { TIPI_CONSENSO } from "@/core/domain/consensi";

const NOMI = { marketing_email: "email", marketing_sms: "SMS", marketing_push: "notifiche sull'app" };

/**
 * La revoca dei consensi promozionali, solo per chi ne ha uno attivo (decisione R3,
 * docs/piani/portale.md). Darli dal portale non si può più; toglierli sì, sempre e dallo stesso
 * posto (GDPR art. 7.3). Una riga: che cosa ricevi, e «Revoca», con una conferma perché dal portale
 * non si torna indietro. Chi non ha consensi attivi non vede niente.
 */
export default function RevocaConsensi() {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [attivi, setAttivi] = useState([]);
  const [inCorso, setInCorso] = useState(false);

  const leggi = (consensi) => setAttivi(TIPI_CONSENSO.filter((t) => consensi?.[t.valore]?.valore).map((t) => t.valore));
  useEffect(() => {
    // Se la lettura non riesce la riga non c'è: è un'aggiunta, non deve rompere il profilo.
    caricaConsensi().then((r) => leggi(r.consensi)).catch(() => setAttivi([]));
  }, []);

  if (!attivi.length) return dialogoConferma;

  const canali = attivi.map((t) => NOMI[t] ?? t).join(", ");
  const revoca = async () => {
    const ok = await conferma({
      title: "Revocare le comunicazioni promozionali?",
      description: `Non riceverai più promozioni per ${canali}. Avvisi e scadenze delle tue lezioni restano nel portale.`,
      confirmLabel: "Revoca",
      destructive: true,
    });
    if (!ok) return;
    setInCorso(true);
    try {
      let ultimo = null;
      for (const tipo of attivi) ultimo = await revocaConsenso(tipo);
      leggi(ultimo?.consensi);
      toast({ title: "Consensi revocati", description: "Non riceverai più comunicazioni promozionali." });
    } catch (err) {
      toast({ title: "Revoca non riuscita", description: err.message, variant: "destructive" });
    }
    setInCorso(false);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <p className="flex-1 text-sm">
          <span className="font-medium">Comunicazioni promozionali</span>
          <span className="block text-muted-foreground">Le ricevi per {canali}.</span>
        </p>
        <Button variant="outline" className="min-h-11" onClick={revoca} disabled={inCorso}>Revoca</Button>
      </CardContent>
      {dialogoConferma}
    </Card>
  );
}
