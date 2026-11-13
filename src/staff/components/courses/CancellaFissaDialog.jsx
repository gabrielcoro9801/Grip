import React, { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { useToast } from "@/ui/primitivi/use-toast";
import { oggiIso } from "@/core/domain/giorni";
import { formatData } from "@/core/domain/format";
import { periodoFissa } from "@/staff/lib/fisse";

/**
 * Cancellare una prenotazione fissa, da un giorno in poi. Si disdicono solo le prenotazioni nate
 * dalla fissa, da quel giorno: quelle fatte a mano restano. Cancellata da oggi la fissa si chiude;
 * da un giorno più avanti finisce il giorno prima.
 *
 * «Dal» va da oggi alla fine della fissa. Il pulsante si accende solo con la spunta: è una
 * disdetta di molte lezioni insieme, e il socio riceve gli avvisi.
 *
 * @param fissa la fissa (GET /api/prenotazioni-fisse), null = chiusa
 * @param onCancellata () => void
 */
export default function CancellaFissaDialog({ fissa, onClose, onCancellata }) {
  const { toast } = useToast();
  const oggi = oggiIso();
  const [dal, setDal] = useState(oggi);
  const [capito, setCapito] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    if (!fissa) return;
    setDal(fissa.dal > oggi ? fissa.dal : oggi);
    setCapito(false);
    setErrore("");
  }, [fissa, oggi]);

  const fuori = !dal || dal < oggi || (fissa?.al && dal > fissa.al);

  const cancella = async () => {
    setInCorso(true);
    setErrore("");
    try {
      const esito = await api.prenotazioniFisse.termina(fissa.id, dal);
      toast({
        title: "Prenotazione fissa cancellata",
        description: `${fissa.socio}: ${esito.disdette === 1 ? "1 prenotazione disdetta" : `${esito.disdette} prenotazioni disdette`}.`,
      });
      onClose();
      onCancellata?.();
    } catch (err) {
      setErrore(err.message);
    }
    setInCorso(false);
  };

  return (
    <Dialog open={!!fissa} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-md">
        {fissa && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" /> Cancellare la prenotazione fissa?
              </DialogTitle>
              <DialogDescription>{fissa.socio} · {fissa.corso} · {periodoFissa(fissa)}</DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="cancella-fissa-dal">Dal</Label>
              <Input
                id="cancella-fissa-dal" type="date" required min={oggi} max={fissa.al || undefined}
                value={dal} onChange={(e) => setDal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {fissa.al ? `Da oggi al ${formatData(fissa.al, "breve")}, l'ultimo giorno della fissa.` : "Da oggi in poi."}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={capito} onCheckedChange={(v) => setCapito(v === true)} className="mt-0.5" />
              <span>
                Si disdicono le prenotazioni nate da questa fissa {dal && !fuori ? `dal ${formatData(dal, "breve")}` : "dal giorno scelto"}.
                {" "}Quelle fatte a mano restano.
              </span>
            </label>
            {errore && <p role="alert" className="text-sm text-destructive">{errore}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={inCorso}>Annulla</Button>
              <Button variant="destructive" onClick={cancella} disabled={!capito || fuori || inCorso}>
                {inCorso ? "Cancellazione…" : "Cancella la fissa"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
