import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import TrasformaInSocio from "@/staff/components/lead/TrasformaInSocio";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { logAction } from "@/staff/lib/auditLog";
import { formatData, toIsoDate } from "@/core/domain/format";
import { SESSI, etichettaSesso } from "@/core/domain/anagrafica";
import { Plus, Search, Contact, Pencil, Trash2, UserCheck } from "lucide-react";

const nuovoLead = () => ({
  nome: "",
  cognome: "",
  telefono: "",
  email: "",
  data_contatto: toIsoDate(new Date()),
  canale_id: "",
  sesso: "",
  anno_nascita: "",
});

const ANNO_CORRENTE = new Date().getFullYear();

export default function Contatti() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_leads");
  // Trasformare crea un socio: serve anche il permesso sui soci, come chiede il server.
  const puoTrasformare = puoModificare && canEdit(staffUser?.ruolo, "crm_members");

  const [leads, setLeads] = useState([]);
  const [canali, setCanali] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);
  const [cerca, setCerca] = useState("");
  const [modulo, setModulo] = useState(null); // { id?, ...campi }
  const [salvando, setSalvando] = useState(false);
  const [daTrasformare, setDaTrasformare] = useState(null);

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([api.entities.Lead.list("-data_contatto"), api.entities.CanaleContatto.list("nome")])
      .then(([l, c]) => { setLeads(l); setCanali(c); })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const nomeCanale = useMemo(() => new Map(canali.map((c) => [c.id, c.nome])), [canali]);

  const visibili = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    if (!t) return leads;
    return leads.filter((l) =>
      `${l.nome} ${l.cognome}`.toLowerCase().includes(t)
      || `${l.cognome} ${l.nome}`.toLowerCase().includes(t)
      || (l.telefono ?? "").includes(t)
      || (l.email ?? "").toLowerCase().includes(t)
    );
  }, [leads, cerca]);

  // Nel modulo si propongono solo i canali attivi, più quello del lead che si sta modificando
  // se nel frattempo è stato disattivato: altrimenti il campo resterebbe vuoto.
  const canaliSceglibili = canali.filter((c) => c.attivo || c.id === modulo?.canale_id);

  const salva = async (e) => {
    e.preventDefault();
    const { id } = modulo;
    // Solo i campi del modulo: il lead letto dall'API si porta dietro anche le date di sistema.
    const campi = Object.fromEntries(Object.keys(nuovoLead()).map((k) => [k, modulo[k]]));
    const dati = { ...campi, anno_nascita: campi.anno_nascita === "" ? null : Number(campi.anno_nascita) };
    setSalvando(true);
    try {
      if (id) {
        await api.entities.Lead.update(id, dati);
      } else {
        const creato = await api.entities.Lead.create(dati);
        await logAction(staffUser, "create", "lead", `${creato.nome} ${creato.cognome}`, creato.id, "Nuovo contatto");
      }
      toast({ title: id ? "Contatto aggiornato" : "Contatto registrato" });
      setModulo(null);
      carica();
    } catch (err) {
      toast({ title: "Contatto non salvato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const elimina = async (lead) => {
    const ok = await conferma({
      title: `Eliminare ${lead.nome} ${lead.cognome}?`,
      description: "Il contatto sparisce anche dai conteggi dell'andamento.",
      confirmLabel: "Elimina",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.entities.Lead.delete(lead.id);
      await logAction(staffUser, "delete", "lead", `${lead.nome} ${lead.cognome}`, lead.id, "Contatto eliminato");
      toast({ title: "Contatto eliminato" });
      carica();
    } catch (err) {
      toast({ title: "Contatto non eliminato", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  const mancaQualcosa = modulo && (
    !modulo.nome.trim() || !modulo.cognome.trim() || !modulo.data_contatto || !modulo.canale_id || !modulo.sesso
  );
  const nessunCanaleAttivo = !canali.some((c) => c.attivo);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {dialogoConferma}
      <PageHeader title="Contatti" description={`${leads.length} ${leads.length === 1 ? "contatto" : "contatti"}`}>
        {puoModificare && (
          <Button size="sm" onClick={() => setModulo(nuovoLead())} disabled={nessunCanaleAttivo}>
            <Plus className="w-4 h-4 mr-1" /> Nuovo contatto
          </Button>
        )}
      </PageHeader>

      {nessunCanaleAttivo && puoModificare && (
        <p className="text-sm rounded-lg bg-warning/10 px-3 py-2">
          Per registrare un contatto serve almeno un canale attivo: <Link to="/lead/canali" className="text-primary font-medium hover:underline">aggiungilo nei canali</Link>.
        </p>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input placeholder="Nome, telefono o email..." value={cerca} onChange={(e) => setCerca(e.target.value)} className="pl-9" aria-label="Cerca contatti" />
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={Contact}
          title={leads.length === 0 ? "Nessun contatto" : "Nessun contatto corrisponde"}
          description={leads.length === 0
            ? "Chi chiede informazioni, in sede, al telefono o sui social, si registra qui."
            : `Nessun risultato per «${cerca}».`}
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="py-3 px-4 font-medium text-muted-foreground">Cognome e nome</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Contatto il</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Canale</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Telefono</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Email</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Sesso</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Anno di nascita</th>
                <th className="py-3 px-4"><span className="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              {visibili.map((l) => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4 font-medium whitespace-nowrap">{l.cognome} {l.nome}</td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{formatData(l.data_contatto, "breve")}</td>
                  <td className="py-3 px-4">{nomeCanale.get(l.canale_id) ?? "—"}</td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{l.telefono || "—"}</td>
                  <td className="py-3 px-4 text-muted-foreground">{l.email || "—"}</td>
                  <td className="py-3 px-4">{etichettaSesso(l.sesso)}</td>
                  <td className="py-3 px-4 text-muted-foreground">{l.anno_nascita ?? "—"}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      {puoTrasformare && (
                        <Button size="sm" variant="outline" className="h-8 whitespace-nowrap" onClick={() => setDaTrasformare(l)}>
                          <UserCheck className="w-3.5 h-3.5 mr-1" /> Trasforma in socio
                        </Button>
                      )}
                      {puoModificare && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Modifica ${l.nome} ${l.cognome}`}
                            onClick={() => setModulo({ ...l, telefono: l.telefono ?? "", email: l.email ?? "", anno_nascita: l.anno_nascita ?? "" })}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Elimina ${l.nome} ${l.cognome}`} onClick={() => elimina(l)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!modulo} onOpenChange={(aperto) => !aperto && setModulo(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{modulo?.id ? "Modifica contatto" : "Nuovo contatto"}</DialogTitle></DialogHeader>
          {modulo && (
            <form onSubmit={salva} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-nome">Nome *</Label>
                  <Input id="lead-nome" required value={modulo.nome} onChange={(e) => setModulo({ ...modulo, nome: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="lead-cognome">Cognome *</Label>
                  <Input id="lead-cognome" required value={modulo.cognome} onChange={(e) => setModulo({ ...modulo, cognome: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-data">Giornata di contatto *</Label>
                  <Input id="lead-data" type="date" required value={modulo.data_contatto} onChange={(e) => setModulo({ ...modulo, data_contatto: e.target.value })} />
                </div>
                <div>
                  <Label>Canale di contatto *</Label>
                  <Select value={modulo.canale_id || undefined} onValueChange={(canale_id) => setModulo({ ...modulo, canale_id })}>
                    <SelectTrigger aria-label="Canale di contatto"><SelectValue placeholder="Scegli" /></SelectTrigger>
                    <SelectContent>
                      {canaliSceglibili.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}{c.attivo ? "" : " (disattivato)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Sesso *</Label>
                  <Select value={modulo.sesso || undefined} onValueChange={(sesso) => setModulo({ ...modulo, sesso })}>
                    <SelectTrigger aria-label="Sesso"><SelectValue placeholder="Scegli" /></SelectTrigger>
                    <SelectContent>
                      {SESSI.map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="lead-anno">Anno di nascita</Label>
                  <Input
                    id="lead-anno"
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={ANNO_CORRENTE}
                    value={modulo.anno_nascita}
                    onChange={(e) => setModulo({ ...modulo, anno_nascita: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-telefono">Telefono</Label>
                  <Input id="lead-telefono" type="tel" value={modulo.telefono} onChange={(e) => setModulo({ ...modulo, telefono: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="lead-email">Email</Label>
                  <Input id="lead-email" type="email" value={modulo.email} onChange={(e) => setModulo({ ...modulo, email: e.target.value })} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={Boolean(mancaQualcosa) || salvando}>
                {salvando ? "Salvataggio..." : "Salva"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <TrasformaInSocio
        lead={daTrasformare}
        staffUser={staffUser}
        onChiudi={(fatto) => { setDaTrasformare(null); if (fatto) carica(); }}
      />
    </div>
  );
}
