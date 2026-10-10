import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { Scelte } from "@/staff/components/lead/AzioneLead";
import { MOTIVI_ABBANDONO, NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";

/**
 * "Se ne va": il socio si archivia con il suo motivo, da un elenco chiuso (shared/lead.js). Lo
 * stesso dalla scheda e da Oggi, per uno scaduto che non torna. Niente si cancella: scheda,
 * abbonamenti e storico restano, e lo si riattiva quando torna; il motivo resta nel diario e la
 * dashboard conta perché se ne vanno.
 *
 * @param socio { id, nome }
 */
export default function DialogoAbbandono({ socio, aperto, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [valori, setValori] = useState({ motivo: null, nota: "" });
  const [salvando, setSalvando] = useState(false);

  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { prenotazioni_disdette: disdette } = await api.soci.archivia(socio.id, valori);
      toast({
        title: `${socio.nome}: archiviato`,
        description: disdette ? `Disdette ${disdette} ${disdette === 1 ? "prenotazione futura" : "prenotazioni future"}.` : "Il motivo è nel diario.",
      });
      setValori({ motivo: null, nota: "" });
      onFatto?.();
      onChiudi();
    } catch (err) {
      toast({ title: "Non archiviato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  return (
    <Dialog open={aperto} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-md">
        <form onSubmit={conferma} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Perché se ne va?</DialogTitle>
            <DialogDescription>
              {socio.nome} viene archiviato: non compare più fra chi frequenta, non prenota, e portale e QR non lo fanno entrare.
              Le prenotazioni future si disdicono. Si riattiva in qualunque momento.
            </DialogDescription>
          </DialogHeader>
          <Scelte etichetta="Motivo" voci={MOTIVI_ABBANDONO} valore={valori.motivo} onScegli={(motivo) => setValori((v) => ({ ...v, motivo }))} />
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="abbandono-nota">Nota{valori.motivo === "altro" ? " *" : ""}</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{valori.nota.length}/{NOTA_DIARIO_MASSIMO}</span>
            </div>
            <Textarea id="abbandono-nota" rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none" placeholder="Es. si trasferisce a Milano"
              value={valori.nota} onChange={(e) => setValori((v) => ({ ...v, nota: e.target.value }))} />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={onChiudi} disabled={salvando}>Annulla</Button>
            <Button type="submit" variant="destructive" disabled={salvando || !valori.motivo || (valori.motivo === "altro" && !valori.nota.trim())}>
              {salvando ? "Salvataggio..." : "Archivia"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
