import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import StatusBadge from "@/ui/StatusBadge";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra, formatData } from "@/core/domain/format";
import { oggiIso } from "@/core/domain/giorni";
import { statoLead, statoAperto, descriviTempoLead, descriviAttivita } from "@/core/domain/lead";
import { linkWhatsApp } from "@/core/domain/anagrafica";
import { Phone, Mail, RotateCcw, Bot, MessageCircle } from "lucide-react";

/**
 * Il diario di un lead: a che punto è, e tutto quello che è successo alla persona — anche prima
 * di questo contatto, se era già nota (un ex socio che richiama). L'arrivo del contatto non è una
 * riga salvata: si mette in fila con le altre per data. Da qui si riapre un lead chiuso.
 */
export default function DiarioLead({ lead, nomeCanale, puoModificare, onChiudi, onCambio }) {
  const { toast } = useToast();
  const [attivita, setAttivita] = useState(null);
  const [errore, setErrore] = useState(null);
  const [riaprendo, setRiaprendo] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setAttivita(null);
    setErrore(null);
    api.lead.attivita(lead.id).then((r) => setAttivita(r.attivita)).catch(setErrore);
  }, [lead]);

  const riapri = async () => {
    setRiaprendo(true);
    try {
      await api.lead.azione(lead.id, "riapri");
      toast({ title: "Contatto riaperto" });
      onCambio();
      onChiudi();
    } catch (err) {
      toast({ title: "Non riaperto", description: err.message, variant: "destructive" });
    }
    setRiaprendo(false);
  };

  const stato = lead && statoLead(lead.stato);
  return (
    <Dialog open={!!lead} onOpenChange={(v) => { if (!v) onChiudi(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle>{lead.nome} {lead.cognome}</DialogTitle>
              <DialogDescription>Arrivato il {formatData(lead.data_contatto, "breve")} da {nomeCanale ?? "—"}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={lead.stato} label={stato.etichetta} tone={stato.tono} />
              <span className="text-xs text-muted-foreground">{descriviTempoLead(lead, oggiIso())}</span>
            </div>

            <div className="space-y-1 text-sm">
              {lead.telefono && <a href={`tel:${lead.telefono}`} className="flex items-center gap-2 text-primary hover:underline"><Phone className="w-4 h-4" aria-hidden="true" />{lead.telefono}</a>}
              {linkWhatsApp(lead.telefono) && <a href={linkWhatsApp(lead.telefono, `Ciao ${lead.nome}!`)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline"><MessageCircle className="w-4 h-4" aria-hidden="true" />Scrivi su WhatsApp</a>}
              {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-primary hover:underline"><Mail className="w-4 h-4" aria-hidden="true" />{lead.email}</a>}
              {lead.note && <p className="text-muted-foreground">{lead.note}</p>}
            </div>

            <section aria-labelledby="diario-titolo">
              <h3 id="diario-titolo" className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Diario</h3>
              {errore && <p className="text-sm text-destructive">{errore.message}</p>}
              {!attivita && !errore && <p className="text-sm text-muted-foreground">Caricamento…</p>}
              {attivita && (
                <ol className="relative border-l border-border ml-1.5 space-y-3">
                  {[{ id: "arrivo", arrivo: true, created_date: lead.created_date }, ...attivita]
                    .sort((x, y) => String(x.created_date).localeCompare(String(y.created_date)))
                    .map((a) => (a.arrivo ? (
                    <li key={a.id} className="pl-4">
                      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
                      <p className="text-sm">Registrato come contatto</p>
                      <p className="text-xs text-muted-foreground">{formatDataOra(lead.created_date)}</p>
                    </li>
                  ) : (
                    <li key={a.id} className="pl-4">
                      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-primary" aria-hidden="true" />
                      <p className="text-sm">{descriviAttivita(a)}</p>
                      {a.nota && <p className="text-sm text-muted-foreground">«{a.nota}»</p>}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {!a.autore_id && <Bot className="w-3 h-3" aria-hidden="true" />}
                        {formatDataOra(a.created_date)} · {a.autore_nome || "—"}
                      </p>
                    </li>
                  )))}
                </ol>
              )}
            </section>

            {puoModificare && !statoAperto(lead.stato) && (
              <Button variant="outline" onClick={riapri} disabled={riaprendo}>
                <RotateCcw className="w-4 h-4 mr-1" /> Riapri il contatto
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
