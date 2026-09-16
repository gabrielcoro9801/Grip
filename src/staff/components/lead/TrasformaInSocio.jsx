import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import CampiAnagrafica, { ANAGRAFICA_VUOTA, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import { logAction } from "@/staff/lib/auditLog";

/**
 * La finestra che trasforma un lead in socio.
 *
 * Parte da quello che il lead ha già — nome, cognome, sesso, recapiti — e chiede il resto
 * dell'anagrafica del socio, codice fiscale per primo. Confermando nasce il socio e il lead
 * sparisce, in un'operazione sola sul server; poi si apre la scheda del socio.
 */
export default function TrasformaInSocio({ lead, staffUser, onChiudi }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [valori, setValori] = useState(ANAGRAFICA_VUOTA);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setValori({
      ...ANAGRAFICA_VUOTA,
      nome: lead.nome,
      cognome: lead.cognome,
      sesso: lead.sesso,
      email: lead.email ?? "",
      phone: lead.telefono ?? "",
    });
  }, [lead]);

  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { member } = await api.lead.trasforma(lead.id, valori);
      await logAction(staffUser, "create", "member", member.full_name, member.id, "Socio creato da un lead");
      toast({ title: "Socio creato", description: `${member.full_name} è ora un socio.` });
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
          <DialogTitle>Trasforma in socio</DialogTitle>
          <DialogDescription>
            Completa l'anagrafica. Confermando nasce il socio con il suo codice, e il contatto viene eliminato.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={conferma} className="space-y-4">
          <CampiAnagrafica valori={valori} onChange={setValori} suggerimentoNascita={suggerimento} />
          {incompleto && <p className="text-xs text-muted-foreground">{incompleto}</p>}
          <Button type="submit" className="w-full" disabled={Boolean(incompleto) || salvando}>
            {salvando ? "Creazione del socio..." : "Crea il socio"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
