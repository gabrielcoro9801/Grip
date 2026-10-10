import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import CampiAnagrafica, { ANAGRAFICA_VUOTA, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";

/**
 * La finestra con cui un contatto si iscrive.
 *
 * Parte da quello che si sa già — dal contatto nome e recapiti, da un ex socio tutta la sua
 * vecchia scheda — e chiede il resto dell'anagrafica, codice fiscale per primo. Confermando
 * nasce il socio (o torna quello di prima, con il suo codice) in un'operazione sola sul server;
 * il contatto resta nel diario della persona. Poi si apre la scheda del socio.
 */
export default function TrasformaInSocio({ lead, onChiudi }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [valori, setValori] = useState(ANAGRAFICA_VUOTA);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!lead) return;
    // Un ex socio ha già una scheda: si riparte da quella, che ha codice fiscale e data di nascita.
    if (lead.socio_id) {
      api.entities.Member.get(lead.socio_id)
        .then((s) => setValori(Object.fromEntries(Object.keys(ANAGRAFICA_VUOTA).map((k) => [k, s[k] ?? ANAGRAFICA_VUOTA[k]]))))
        .catch(() => {});
    }
    setValori({
      ...ANAGRAFICA_VUOTA,
      nome: lead.nome,
      cognome: lead.cognome ?? "",
      sesso: lead.sesso ?? "",
      email: lead.email ?? "",
      phone: lead.telefono ?? "",
      // La nota del contatto diventa la prima nota del socio: è la stessa segreteria che la
      // legge, e al socio non arriva. Si può correggere qui prima di confermare.
      notes: lead.note ?? "",
    });
  }, [lead]);

  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const esito = await api.lead.trasforma(lead.id, valori);
      const { member, riattivato } = esito;
      toast({ title: riattivato ? "Socio riattivato" : "Socio creato", description: riattivato ? `${member.full_name} è tornato socio, con il suo codice.` : `${member.full_name} è ora un socio.` });
      onChiudi(true);
      navigate(`/crm/soci/${member.id}`);
    } catch (err) {
      toast({ title: "Trasformazione non riuscita", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const incompleto = motivoAnagraficaIncompleta(valori);
  const suggerimento = lead?.anno_nascita ? `Il contatto aveva indicato il ${lead.anno_nascita}.` : null;

  return (
    <Dialog open={!!lead} onOpenChange={(aperta) => !aperta && onChiudi(false)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Iscrivi</DialogTitle>
          <DialogDescription>
            {lead?.socio_id
              ? "È già stato socio: controlla i dati della sua scheda. Confermando torna socio, con il suo codice e la sua storia."
              : "Completa l'anagrafica. Confermando nasce il socio con il suo codice; la storia del contatto resta nel suo diario."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={conferma} className="space-y-4">
          <CampiAnagrafica valori={valori} onChange={setValori} suggerimentoNascita={suggerimento} />
          {incompleto && <p className="text-xs text-muted-foreground">{incompleto}</p>}
          <Button type="submit" className="w-full" disabled={Boolean(incompleto) || salvando}>
            {salvando ? "Iscrizione..." : lead?.socio_id ? "Riattiva il socio" : "Crea il socio"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
