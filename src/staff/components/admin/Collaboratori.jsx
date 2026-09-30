import React, { useState, useMemo } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Badge } from "@/ui/primitivi/badge";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Pencil, UserPlus, Ban, CheckCircle2, Search, Trash2 } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { formatData } from "@/core/domain/format";

/** I due rapporti che la colonna ammette, con l'etichetta breve per la tabella. */
export const TIPO_RAPPORTO = { dipendente: "Dipendente", collaboratore_sportivo: "Coll. sportivo" };

const formVuoto = { nome: "", cognome: "", tipo_rapporto: "", ruolo: "", email: "", phone: "", hire_date: "", notes: "" };

/**
 * L'anagrafica di chi lavora nella struttura.
 *
 * La tabella c'era, e gli account degli utenti interni avevano un campo "Collaboratore
 * collegato", ma nessuna schermata creava un collaboratore: il campo restava vuoto per sempre.
 * Un collaboratore non è un account — molti non entrano mai nell'applicazione — e un account
 * può legarsi a lui dalla scheda «Utenti interni».
 *
 * Si elimina finché nessun account lo cita; dopo si disattiva, e sparisce dalle scelte.
 */
export default function Collaboratori({ collaboratori, accounts, organizationId, reload }) {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [cerca, setCerca] = useState("");
  const [mostraForm, setMostraForm] = useState(false);
  const [inModifica, setInModifica] = useState(null);
  const [form, setForm] = useState(formVuoto);
  const [saving, setSaving] = useState(false);

  const accountDi = useMemo(() => {
    const perCollaboratore = new Map();
    for (const a of accounts) if (a.linked_collaboratore_id) perCollaboratore.set(a.linked_collaboratore_id, a);
    return perCollaboratore;
  }, [accounts]);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return [...collaboratori]
      .filter((c) => !q || `${c.nome} ${c.cognome} ${c.ruolo ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.attivo !== false) - Number(a.attivo !== false)
        || `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, "it", { sensitivity: "base" }));
  }, [collaboratori, cerca]);

  const apriNuovo = () => {
    setInModifica(null);
    setForm(formVuoto);
    setMostraForm(true);
  };

  const apriModifica = (c) => {
    setInModifica(c);
    setForm({
      nome: c.nome ?? "",
      cognome: c.cognome ?? "",
      tipo_rapporto: c.tipo_rapporto ?? "",
      ruolo: c.ruolo ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      hire_date: c.hire_date ?? "",
      notes: c.notes ?? "",
    });
    setMostraForm(true);
  };

  const salva = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (inModifica) {
        await api.entities.Collaboratore.update(inModifica.id, form);
        toast({ title: "Collaboratore aggiornato", description: `${form.nome} ${form.cognome}` });
      } else {
        await api.entities.Collaboratore.create({ ...form, organization_id: organizationId ?? null, attivo: true });
        toast({ title: "Collaboratore aggiunto", description: `${form.nome} ${form.cognome}` });
      }
      setMostraForm(false);
      setInModifica(null);
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const commutaAttivo = async (c) => {
    const attivo = c.attivo === false;
    try {
      await api.entities.Collaboratore.update(c.id, { attivo });
      toast({ title: attivo ? "Collaboratore riattivato" : "Collaboratore disattivato", description: `${c.nome} ${c.cognome}` });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const elimina = async (c) => {
    const account = accountDi.get(c.id);
    if (account) {
      toast({
        title: "Questo collaboratore non si può eliminare",
        description: `L'account «${account.nome}» è collegato a lui: scollegalo da «Utenti interni», oppure disattiva il collaboratore.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({ title: `Eliminare ${c.nome} ${c.cognome}?`, confirmLabel: "Elimina", destructive: true });
    if (!ok) return;
    try {
      await api.entities.Collaboratore.delete(c.id);
      toast({ title: "Collaboratore eliminato" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Cerca per nome, mansione o email…"
            aria-label="Cerca un collaboratore"
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button size="sm" onClick={apriNuovo}>
          <UserPlus className="w-4 h-4 mr-1" /> Nuovo collaboratore
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Rapporto</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Mansione</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Contatti</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Account</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtrati.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  {cerca ? "Nessun collaboratore corrisponde alla ricerca" : "Nessun collaboratore: aggiungi chi lavora nella struttura."}
                </td>
              </tr>
            ) : filtrati.map((c) => {
              const account = accountDi.get(c.id);
              return (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4 font-medium">
                    {c.nome} {c.cognome}
                    {c.hire_date && <p className="text-xs text-muted-foreground font-normal">Dal {formatData(c.hire_date, "breve")}</p>}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{TIPO_RAPPORTO[c.tipo_rapporto] || c.tipo_rapporto}</td>
                  <td className="py-3 px-4 text-muted-foreground">{c.ruolo || "—"}</td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                    {!c.email && !c.phone && "—"}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">{account ? account.email : "—"}</td>
                  <td className="py-3 px-4">
                    {c.attivo !== false ? (
                      <Badge className="bg-success/10 text-success border-success/30">Attivo</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground border-border">Disattivato</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-9 w-9" title="Modifica" aria-label={`Modifica ${c.nome} ${c.cognome}`} onClick={() => apriModifica(c)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-9 w-9"
                        title={c.attivo !== false ? "Disattiva" : "Riattiva"}
                        aria-label={`${c.attivo !== false ? "Disattiva" : "Riattiva"} ${c.nome} ${c.cognome}`}
                        onClick={() => commutaAttivo(c)}
                      >
                        {c.attivo !== false
                          ? <Ban className="w-3.5 h-3.5 text-destructive" />
                          : <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" title="Elimina" aria-label={`Elimina ${c.nome} ${c.cognome}`} onClick={() => elimina(c)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={mostraForm} onOpenChange={(v) => { setMostraForm(v); if (!v) setInModifica(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inModifica ? "Modifica collaboratore" : "Nuovo collaboratore"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>Cognome *</Label><Input required value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></div>
            </div>
            <div>
              <Label>Tipo di rapporto *</Label>
              <Select value={form.tipo_rapporto} onValueChange={(v) => setForm({ ...form, tipo_rapporto: v })}>
                <SelectTrigger><SelectValue placeholder="Scegli" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dipendente">Dipendente</SelectItem>
                  <SelectItem value="collaboratore_sportivo">Collaboratore sportivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Mansione</Label><Input placeholder="Es. Istruttore, Reception" value={form.ruolo} onChange={(e) => setForm({ ...form, ruolo: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>In servizio dal</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></div>
            <div><Label>Note</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={saving || !form.nome.trim() || !form.cognome.trim() || !form.tipo_rapporto}>
              {saving ? "Salvataggio…" : inModifica ? "Salva modifiche" : "Aggiungi collaboratore"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {dialogoConferma}
    </div>
  );
}
