import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Lock } from "lucide-react";

const TIPO_LABELS = {
  attivo: "Attivo",
  passivo: "Passivo",
  patrimonio_netto: "Patrimonio Netto",
  ricavo: "Ricavo",
  costo: "Costo",
};

export default function ChartOfAccounts() {
  const { organization, loading: orgLoading } = useOrganization();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTipo, setFilterTipo] = useState("tutti");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ codice: "", nome: "", tipo_conto: "attivo", natura: "dare", conto_padre_id: "", gestisce_iva: false });

  const loadAccounts = (orgId) => {
    base44.entities.ChartOfAccount.filter({ organization_id: orgId }, "codice").then(a => { setAccounts(a); setLoading(false); });
  };

  useEffect(() => {
    if (organization) loadAccounts(organization.id);
  }, [organization]);

  const filtered = useMemo(() => {
    return filterTipo === "tutti" ? accounts : accounts.filter(a => a.tipo_conto === filterTipo);
  }, [accounts, filterTipo]);

  const roots = filtered.filter(a => !a.conto_padre_id);
  const getChildren = (id) => filtered.filter(a => a.conto_padre_id === id);

  const handleCreate = async (e) => {
    e.preventDefault();
    await base44.entities.ChartOfAccount.create({
      ...form,
      organization_id: organization.id,
      conto_padre_id: form.conto_padre_id || undefined,
      sistema: false,
      attivo: true,
    });
    setShowForm(false);
    setForm({ codice: "", nome: "", tipo_conto: "attivo", natura: "dare", conto_padre_id: "", gestisce_iva: false });
    loadAccounts(organization.id);
  };

  const renderAccount = (acc, depth = 0) => {
    const children = getChildren(acc.id);
    return (
      <div key={acc.id}>
        <div className="flex items-center justify-between py-2.5 px-4 border-b border-border/50 hover:bg-muted/30" style={{ paddingLeft: `${16 + depth * 24}px` }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-muted-foreground w-12">{acc.codice}</span>
            <span className="text-sm font-medium">{acc.nome}</span>
            {acc.sistema && <Lock className="w-3 h-3 text-muted-foreground" />}
            {acc.gestisce_iva && <Badge variant="outline" className="text-xs">IVA</Badge>}
            {!acc.attivo && <Badge variant="secondary" className="text-xs">Disattivo</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{TIPO_LABELS[acc.tipo_conto]}</Badge>
            <span className="text-xs text-muted-foreground w-14 text-right capitalize">{acc.natura}</span>
          </div>
        </div>
        {children.map(c => renderAccount(c, depth + 1))}
      </div>
    );
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Piano dei conti" description="Struttura dei conti contabili dell'organizzazione">
        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti i tipi</SelectItem>
            {Object.entries(TIPO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo conto</Button>
      </PageHeader>

      <div className="border border-border rounded-lg overflow-hidden">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun conto trovato</p>
        ) : roots.map(a => renderAccount(a))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo conto</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Codice *</Label><Input required value={form.codice} onChange={e => setForm({...form, codice: e.target.value})} placeholder="es. 6.6" /></div>
              <div>
                <Label>Natura *</Label>
                <Select value={form.natura} onValueChange={v => setForm({...form, natura: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dare">Dare</SelectItem>
                    <SelectItem value="avere">Avere</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} /></div>
            <div>
              <Label>Tipo conto *</Label>
              <Select value={form.tipo_conto} onValueChange={v => setForm({...form, tipo_conto: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Conto padre (opzionale)</Label>
              <Select value={form.conto_padre_id || "none"} onValueChange={v => setForm({...form, conto_padre_id: v === "none" ? "" : v})}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuno</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="gestisce_iva" checked={form.gestisce_iva} onCheckedChange={c => setForm({...form, gestisce_iva: !!c})} />
              <Label htmlFor="gestisce_iva" className="font-normal">Gestisce IVA</Label>
            </div>
            <Button type="submit" className="w-full">Crea conto</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}