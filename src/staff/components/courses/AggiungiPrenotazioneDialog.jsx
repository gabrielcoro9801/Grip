import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import SceltaSocio from "@/staff/components/courses/SceltaSocio";
import { formatData } from "@/core/domain/format";

const hhmm = (t) => String(t ?? "").slice(0, 5);

/**
 * Prenotare un socio alla lezione che si sta guardando. La lezione non si sceglie: è quella
 * della pagina. Si sceglie il socio (SceltaSocio), poi «Conferma prenotazione».
 *
 * Posti, abbonamento e lista d'attesa li decide il server: se la lezione è piena il socio va in
 * lista, e un socio senza abbonamento valido quel giorno non si prenota.
 *
 * @param lezione      la lezione (GET /api/calendario/lezioni/:id)
 * @param prenotazioni le sue prenotazioni: chi ne ha una viva non si sceglie
 */
export default function AggiungiPrenotazioneDialog({ open, onClose, lezione, prenotazioni, onPrenotato }) {
  const { toast } = useToast();
  const [socio, setSocio] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState("");

  useEffect(() => { if (open) { setSocio(null); setErrore(""); } }, [open]);

  const giaPrenotati = useMemo(
    () => new Set(prenotazioni.filter((p) => p.status !== "cancelled").map((p) => p.member_id)),
    [prenotazioni],
  );
  const piena = lezione.confermati >= lezione.capacity;

  const prenota = async () => {
    if (!socio) return;
    setInCorso(true);
    setErrore("");
    try {
      const { booking } = await api.prenotazioni.crea({ sessionId: lezione.id, memberId: socio.id });
      toast({
        title: booking.status === "confirmed" ? "Prenotazione confermata" : "Aggiunto alla lista d'attesa",
        description: booking.status === "confirmed"
          ? `${socio.nome} ${socio.cognome}`
          : `${socio.nome} ${socio.cognome}, posizione ${booking.waitlist_position}`,
      });
      onPrenotato();
      onClose();
    } catch (err) {
      setErrore(err.message);
    }
    setInCorso(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aggiungi prenotazione</DialogTitle>
          <DialogDescription>
            {lezione.corso} · {formatData(lezione.date, "estesaBreve")}, {hhmm(lezione.start_time)}–{hhmm(lezione.end_time)}
            {" · "}{lezione.confermati}/{lezione.capacity} posti
          </DialogDescription>
        </DialogHeader>
        <SceltaSocio scelto={socio} onScegli={setSocio} giaPrenotati={giaPrenotati} />
        <p className="text-xs text-muted-foreground">
          {piena ? "La lezione è al completo: il socio va in lista d'attesa." : "Se la lezione è al completo il socio va in lista d'attesa."}
          {" "}Servono un abbonamento valido quel giorno e un socio non archiviato.
        </p>
        {errore && <p role="alert" className="text-sm text-destructive">{errore}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={inCorso}>Annulla</Button>
          <Button onClick={prenota} disabled={!socio || inCorso}>
            {inCorso ? "Prenotazione…" : "Conferma prenotazione"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
