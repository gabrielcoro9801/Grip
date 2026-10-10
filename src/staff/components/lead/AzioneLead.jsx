import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { CANALI_CONTATTO, MOTIVI_CHIUSURA, NOTE_LEAD_MASSIMO, statoLead } from "@/core/domain/lead";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import { PhoneOff, MessageCircle } from "lucide-react";

const TITOLI = {
  contatto: "Contattato",
  richiamo: "Da richiamare",
  chiudi: "Non interessato",
};

/** Un gruppo di pulsanti a scelta singola, con aria-pressed. */
export function Scelte({ etichetta, voci, valore, onScegli }) {
  return (
    <div>
      <Label>{etichetta}</Label>
      <div className="flex flex-wrap gap-2 mt-1">
        {voci.map((v) => (
          <button
            key={v.valore} type="button" aria-pressed={valore === v.valore} onClick={() => onScegli(v.valore)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              valore === v.valore ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"
            }`}
          >
            {v.etichetta}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Le azioni con cui si lavora un lead: com'è andato un contatto, quando richiamarlo, perché non è
 * interessato. Ognuna cambia lo stato secondo le regole di `applicaAzione` (shared/lead.js) e
 * lascia una riga nel diario, con la nota se c'è.
 *
 * @param richiesta { lead, tipo: 'contatto' | 'richiamo' | 'chiudi' } o null
 */
export default function AzioneLead({ richiesta, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [valori, setValori] = useState({});
  const [salvando, setSalvando] = useState(false);
  const tipo = richiesta?.tipo;
  const lead = richiesta?.lead;

  useEffect(() => {
    if (!richiesta) return;
    setValori({ canale: "telefono", esito: null, data: spostaGiorni(oggiIso(), 7), motivo: null, nota: "" });
  }, [richiesta]);

  const imposta = (campo) => (v) => setValori((p) => ({ ...p, [campo]: v }));

  const manca = !tipo ? true
    : tipo === "contatto" ? !valori.canale || !valori.esito
    : tipo === "richiamo" ? !valori.data || valori.data < oggiIso()
    : !valori.motivo || (valori.motivo === "altro" && !valori.nota?.trim());

  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const corpo = tipo === "contatto" ? { canale: valori.canale, esito: valori.esito }
        : tipo === "richiamo" ? { data: valori.data }
        : { motivo: valori.motivo };
      const { lead: aggiornato } = await api.lead.azione(lead.id, tipo, { ...corpo, nota: valori.nota });
      toast({ title: `${lead.nome} ${lead.cognome}`, description: statoLead(aggiornato.stato).etichetta });
      onFatto();
      onChiudi();
    } catch (err) {
      toast({ title: "Azione non riuscita", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  return (
    <Dialog open={!!richiesta} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-md">
        {richiesta && (
          <form onSubmit={conferma} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{TITOLI[tipo]}</DialogTitle>
              <DialogDescription>{lead.nome} {lead.cognome}{lead.telefono ? ` · ${lead.telefono}` : ""}</DialogDescription>
            </DialogHeader>

            {tipo === "contatto" && (
              <>
                <Scelte etichetta="Come" voci={CANALI_CONTATTO} valore={valori.canale} onScegli={imposta("canale")} />
                <div>
                  <Label>Com'è andata</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {[
                      { valore: "risposto", etichetta: "Ha risposto", icona: MessageCircle },
                      { valore: "nessuna_risposta", etichetta: "Non ha risposto", icona: PhoneOff },
                    ].map((v) => (
                      <button
                        key={v.valore} type="button" aria-pressed={valori.esito === v.valore} onClick={() => imposta("esito")(v.valore)}
                        className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                          valori.esito === v.valore ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <v.icona className="w-4 h-4" aria-hidden="true" /> {v.etichetta}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tipo === "richiamo" && (
              <div>
                <Label htmlFor="azione-data">Richiamare il</Label>
                <Input id="azione-data" type="date" min={oggiIso()} value={valori.data} onChange={(e) => imposta("data")(e.target.value)} />
              </div>
            )}

            {tipo === "chiudi" && (
              <Scelte etichetta="Motivo" voci={MOTIVI_CHIUSURA} valore={valori.motivo} onScegli={imposta("motivo")} />
            )}

            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="azione-nota">Nota{tipo === "chiudi" && valori.motivo === "altro" ? " *" : ""}</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{(valori.nota ?? "").length}/{NOTE_LEAD_MASSIMO}</span>
              </div>
              <Textarea
                id="azione-nota" rows={2} maxLength={NOTE_LEAD_MASSIMO} className="resize-none"
                value={valori.nota ?? ""} onChange={(e) => imposta("nota")(e.target.value)}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button type="button" variant="outline" onClick={onChiudi} disabled={salvando}>Annulla</Button>
              <Button type="submit" disabled={manca || salvando}>{salvando ? "Salvataggio..." : "Conferma"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
