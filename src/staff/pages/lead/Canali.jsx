import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Plus, Check, X, Pencil, Trash2 } from "lucide-react";

/**
 * I canali da cui arrivano i contatti.
 *
 * Li decide la palestra: una usa Instagram, un'altra il volantino in farmacia. Un canale che
 * qualche contatto usa non si elimina — quei contatti resterebbero senza provenienza e i conti
 * dell'andamento sbaglierebbero — ma si disattiva: sparisce dal modulo, resta sui contatti vecchi.
 */
export default function Canali() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_leads");

  const [canali, setCanali] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);
  const [nuovo, setNuovo] = useState("");
  const [inModifica, setInModifica] = useState(null); // { id, nome }

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([api.entities.CanaleContatto.list("nome"), api.entities.Lead.list()])
      .then(([c, l]) => { setCanali(c); setLeads(l); })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const usi = useMemo(() => {
    const conti = new Map();
    for (const l of leads) conti.set(l.canale_id, (conti.get(l.canale_id) ?? 0) + 1);
    return conti;
  }, [leads]);

  const esegui = async (operazione, messaggio) => {
    try {
      await operazione();
      toast({ title: messaggio });
      carica();
      return true;
    } catch (err) {
      toast({ title: "Operazione non riuscita", description: err.message, variant: "destructive" });
      return false;
    }
  };

  const aggiungi = async (e) => {
    e.preventDefault();
    const nome = nuovo.trim();
    if (!nome) return;
    if (await esegui(() => api.entities.CanaleContatto.create({ nome }), "Canale aggiunto")) setNuovo("");
  };

  const rinomina = async (e) => {
    e.preventDefault();
    const nome = inModifica.nome.trim();
    if (!nome) return;
    if (await esegui(() => api.entities.CanaleContatto.update(inModifica.id, { nome }), "Canale rinominato")) setInModifica(null);
  };

  const elimina = async (canale) => {
    const ok = await conferma({ title: `Eliminare il canale «${canale.nome}»?`, confirmLabel: "Elimina", destructive: true });
    if (ok) esegui(() => api.entities.CanaleContatto.delete(canale.id), "Canale eliminato");
  };

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {dialogoConferma}
      <PageHeader title="Canali di contatto" description="Da dove arrivano i contatti. Quelli disattivati non si propongono più, ma restano sui contatti già registrati." />

      {puoModificare && (
        <form onSubmit={aggiungi} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="canale-nuovo">Nuovo canale</Label>
            <Input id="canale-nuovo" placeholder="Es. Volantino" value={nuovo} onChange={(e) => setNuovo(e.target.value)} maxLength={80} />
          </div>
          <Button type="submit" disabled={!nuovo.trim()}><Plus className="w-4 h-4 mr-1" /> Aggiungi</Button>
        </form>
      )}

      <ul className="divide-y divide-border border border-border rounded-lg">
        {canali.length === 0 && <li className="p-4 text-sm text-muted-foreground text-center">Nessun canale</li>}
        {canali.map((c) => {
          const usato = usi.get(c.id) ?? 0;
          const modifica = inModifica?.id === c.id;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              {modifica ? (
                <form onSubmit={rinomina} className="flex flex-1 items-center gap-2">
                  <Input
                    aria-label="Nome del canale"
                    value={inModifica.nome}
                    onChange={(e) => setInModifica({ ...inModifica, nome: e.target.value })}
                    maxLength={80}
                    autoFocus
                  />
                  <Button type="submit" size="icon" variant="ghost" className="h-9 w-9" aria-label="Salva nome"><Check className="w-4 h-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Annulla" onClick={() => setInModifica(null)}><X className="w-4 h-4" /></Button>
                </form>
              ) : (
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${c.attivo ? "" : "text-muted-foreground"}`}>{c.nome}</p>
                  <p className="text-xs text-muted-foreground">{usato} {usato === 1 ? "contatto" : "contatti"}</p>
                </div>
              )}
              <StatusBadge status={c.attivo ? "attivo" : "disattivato"} label={c.attivo ? "Attivo" : "Disattivato"} tone={c.attivo ? "positivo" : "neutro"} />
              {puoModificare && !modifica && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => esegui(() => api.entities.CanaleContatto.update(c.id, { attivo: !c.attivo }), c.attivo ? "Canale disattivato" : "Canale riattivato")}
                  >
                    {c.attivo ? "Disattiva" : "Riattiva"}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Rinomina ${c.nome}`} onClick={() => setInModifica({ id: c.id, nome: c.nome })}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {/* Un canale usato non si elimina: si disattiva. Il pulsante non compare
                      nemmeno, invece di comparire e rispondere con un errore. */}
                  {usato === 0 && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Elimina ${c.nome}`} onClick={() => elimina(c)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
