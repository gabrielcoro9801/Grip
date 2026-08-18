import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Pencil, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const ICON_OPTIONS = [
  { value: "ticket", label: "Biglietto" }, { value: "users", label: "Persone" },
  { value: "dumbbell", label: "Pesi" }, { value: "package", label: "Pacco" },
  { value: "building", label: "Edificio" }, { value: "plus-circle", label: "Più" },
  { value: "home", label: "Casa" }, { value: "zap", label: "Lampo" },
  { value: "truck", label: "Camion" }, { value: "landmark", label: "Banca" },
  { value: "briefcase", label: "Valigetta" }, { value: "minus-circle", label: "Meno" },
];

const emptyForm = {
  nome_visibile: "", tipo: "entrata", icona: "plus-circle",
  conto_contropartita_id: "", richiede_controparte: false, tipo_controparte: "cliente",
  gestisce_iva: true, aliquota_iva_default: 22, permette_a_credito: false, conto_credito_debito_id: "",
  puo_essere_istituzionale: false,
};

export default function CausaliOperative() {
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [causali, setCausali] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(() => {
    if (!organization) return;
    Promise.all([
      api.entities.CausaleOperativa.filter({ organization_id: organization.id }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id, attivo: true }, "codice"),
    ]).then(([c, a]) => { setCausali(c); setAccounts(a); setLoading(false); });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const accountName = (id) => {
    const a = accounts.find(a => a.id === id);
    return a ? `${a.codice} — ${a.nome}` : "—";
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      nome_visibile: c.nome_visibile, tipo: c.tipo, icona: c.icona,
      conto_contropartita_id: c.conto_contropartita_id || "",
      richiede_controparte: c.richiede_controparte || false,
      tipo_controparte: c.tipo_controparte || "cliente",
      gestisce_iva: c.gestisce_iva ?? true, aliquota_iva_default: c.aliquota_iva_default ?? 22,
      permette_a_credito: c.permette_a_credito || false,
      conto_credito_debito_id: c.conto_credito_debito_id || "",
      puo_essere_istituzionale: c.puo_essere_istituzionale || false,
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      organization_id: organization.id,
      aliquota_iva_default: Number(form.aliquota_iva_default) || 0,
      conto_credito_debito_id: form.permette_a_credito ? form.conto_credito_debito_id : undefined,
      tipo_controparte: form.richiede_controparte ? form.tipo_controparte : undefined,
    };
    if (editing) {
      await api.entities.CausaleOperativa.update(editing.id, payload);
      toast({ title: "Causale aggiornata" });
    } else {
      await api.entities.CausaleOperativa.create({ ...payload, sistema: false, attivo: true });
      toast({ title: "Causale creata" });
    }
    setShowForm(false);
    loadData();
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Gestione causali operative" description="Configura le causali per il flusso guidato">
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuova causale</Button>
      </PageHeader>

      <div className="grid sm:grid-cols-2 gap-4">
        {causali.map(c => (
          <Card key={c.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant={c.tipo === "entrata" ? "default" : "destructive"} className="text-xs">
                    {c.tipo === "entrata" ? "Entrata" : "Uscita"}
                  </Badge>
                  {c.sistema && <Lock className="w-3 h-3 text-muted-foreground" />}
                  {!c.attivo && <Badge variant="secondary" className="text-xs">Disattiva</Badge>}
                </div>
                {!c.sistema && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <h3 className="font-medium text-sm mb-2">{c.nome_visibile}</h3>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>Conto: <span className="font-medium text-foreground">{accountName(c.conto_contropartita_id)}</span></div>
                {c.richiede_controparte && <div>Controparte: <span className="font-medium text-foreground">{c.tipo_controparte === "cliente" ? "Cliente" : "Fornitore"}</span></div>}
                {c.gestisce_iva && <div>IVA: <span className="font-medium text-foreground">{c.aliquota_iva_default}%</span></div>}
                {c.permette_a_credito && <div>A credito: <span className="font-medium text-foreground">{accountName(c.conto_credito_debito_id)}</span></div>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifica causale" : "Nuova causale"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>Nome visibile *</Label><Input required value={form.nome_visibile} onChange={e => setForm({ ...form, nome_visibile: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo *</Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrata">Entrata</SelectItem>
                    <SelectItem value="uscita">Uscita</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Icona</Label>
                <Select value={form.icona} onValueChange={v => setForm({ ...form, icona: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Conto contropartita *</Label>
              <Select value={form.conto_contropartita_id} onValueChange={v => setForm({ ...form, conto_contropartita_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona conto" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="richiede_controparte" checked={form.richiede_controparte} onCheckedChange={c => setForm({ ...form, richiede_controparte: !!c })} />
              <Label htmlFor="richiede_controparte" className="font-normal">Richiede controparte</Label>
            </div>
            {form.richiede_controparte && (
              <div>
                <Label>Tipo controparte</Label>
                <Select value={form.tipo_controparte} onValueChange={v => setForm({ ...form, tipo_controparte: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cliente">Cliente</SelectItem>
                    <SelectItem value="fornitore">Fornitore</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox id="gestisce_iva" checked={form.gestisce_iva} onCheckedChange={c => setForm({ ...form, gestisce_iva: !!c })} />
              <Label htmlFor="gestisce_iva" className="font-normal">Gestisce IVA</Label>
            </div>
            {form.gestisce_iva && (
              <div><Label>Aliquota IVA default (%)</Label><Input type="number" value={form.aliquota_iva_default} onChange={e => setForm({ ...form, aliquota_iva_default: e.target.value })} /></div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox id="permette_a_credito" checked={form.permette_a_credito} onCheckedChange={c => setForm({ ...form, permette_a_credito: !!c })} />
              <Label htmlFor="permette_a_credito" className="font-normal">Permette a credito</Label>
            </div>
            {form.tipo === "entrata" && (
              <div className="flex items-center gap-2">
                <Checkbox id="puo_essere_istituzionale" checked={form.puo_essere_istituzionale} onCheckedChange={c => setForm({ ...form, puo_essere_istituzionale: !!c })} />
                <Label htmlFor="puo_essere_istituzionale" className="font-normal">Può essere istituzionale (se il pagante è socio/tesserato)</Label>
              </div>
            )}
            {form.permette_a_credito && (
              <div>
                <Label>Conto credito/debito</Label>
                <Select value={form.conto_credito_debito_id || "none"} onValueChange={v => setForm({ ...form, conto_credito_debito_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona conto" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Nessuno —</SelectItem>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" className="w-full">{editing ? "Salva" : "Crea causale"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}