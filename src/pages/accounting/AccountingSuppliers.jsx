import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

export default function AccountingSuppliers() {
  const { organization, loading: orgLoading } = useOrganization();
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ragione_sociale: "", piva_cf: "", iban: "", conto_costo_default_id: "", email: "", telefono: "" });

  const loadData = (orgId) => {
    Promise.all([
      api.entities.AccountingSupplier.filter({ organization_id: orgId }),
      api.entities.ChartOfAccount.filter({ organization_id: orgId, tipo_conto: "costo" }),
    ]).then(([s, a]) => { setSuppliers(s); setAccounts(a); setLoading(false); });
  };

  useEffect(() => { if (organization) loadData(organization.id); }, [organization]);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.entities.AccountingSupplier.create({
      ...form,
      organization_id: organization.id,
      conto_costo_default_id: form.conto_costo_default_id || undefined,
      attivo: true,
    });
    setShowForm(false);
    setForm({ ragione_sociale: "", piva_cf: "", iban: "", conto_costo_default_id: "", email: "", telefono: "" });
    loadData(organization.id);
  };

  const accountName = (id) => {
    const a = accounts.find(a => a.id === id);
    return a ? `${a.codice} — ${a.nome}` : null;
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Fornitore</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map(s => (
          <Card key={s.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm">{s.ragione_sociale}</h3>
                {!s.attivo && <Badge variant="secondary" className="text-xs">Disattivo</Badge>}
              </div>
              {s.piva_cf && <p className="text-xs text-muted-foreground">P.IVA/CF: {s.piva_cf}</p>}
              {s.iban && <p className="text-xs text-muted-foreground">IBAN: {s.iban}</p>}
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                {s.email && <span>{s.email}</span>}
                {s.telefono && <span>{s.telefono}</span>}
              </div>
              {accountName(s.conto_costo_default_id) && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  Conto costo: {accountName(s.conto_costo_default_id)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {suppliers.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">Nessun fornitore registrato</p>}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo fornitore</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Ragione sociale *</Label><Input required value={form.ragione_sociale} onChange={e => setForm({...form, ragione_sociale: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>P.IVA/CF</Label><Input value={form.piva_cf} onChange={e => setForm({...form, piva_cf: e.target.value})} /></div>
              <div><Label>IBAN</Label><Input value={form.iban} onChange={e => setForm({...form, iban: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Telefono</Label><Input value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} /></div>
            </div>
            <div>
              <Label>Conto costo default</Label>
              <Select value={form.conto_costo_default_id || "none"} onValueChange={v => setForm({...form, conto_costo_default_id: v === "none" ? "" : v})}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuno</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">Crea fornitore</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}