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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Receipt, AlertTriangle } from "lucide-react";
import { TIPI_SOGGETTO, ALIQUOTA_RITENUTA_ORDINARIA, ritenutaDovuta, motivoEsenzione } from "../../../shared/ritenuta.js";

const emptyForm = {
  ragione_sociale: "", piva_cf: "", iban: "", conto_costo_default_id: "", email: "", telefono: "",
  tipo_soggetto: "", regime_forfettario: false, aliquota_ritenuta: "",
};

export default function AccountingSuppliers() {
  const { organization, loading: orgLoading } = useOrganization();
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const loadData = (orgId) => {
    Promise.all([
      api.entities.AccountingSupplier.filter({ organization_id: orgId }),
      api.entities.ChartOfAccount.filter({ organization_id: orgId, tipo_conto: "costo" }),
    ]).then(([s, a]) => { setSuppliers(s); setAccounts(a); setLoading(false); });
  };

  useEffect(() => { if (organization) loadData(organization.id); }, [organization]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      ragione_sociale: s.ragione_sociale || "", piva_cf: s.piva_cf || "", iban: s.iban || "",
      conto_costo_default_id: s.conto_costo_default_id || "", email: s.email || "", telefono: s.telefono || "",
      tipo_soggetto: s.tipo_soggetto || "", regime_forfettario: !!s.regime_forfettario,
      aliquota_ritenuta: s.aliquota_ritenuta ?? "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      conto_costo_default_id: form.conto_costo_default_id || null,
      tipo_soggetto: form.tipo_soggetto || null,
      aliquota_ritenuta: form.aliquota_ritenuta === "" ? null : Number(form.aliquota_ritenuta),
    };
    if (editing) {
      await api.entities.AccountingSupplier.update(editing.id, payload);
    } else {
      await api.entities.AccountingSupplier.create({ ...payload, organization_id: organization.id, attivo: true });
    }
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    loadData(organization.id);
  };

  // Anteprima della regola mentre si compila il form, così l'effetto della scelta è
  // visibile prima di salvare e non solo al momento del pagamento.
  const anteprimaFornitore = {
    tipo_soggetto: form.tipo_soggetto,
    regime_forfettario: form.regime_forfettario,
    aliquota_ritenuta: form.aliquota_ritenuta,
  };

  const accountName = (id) => {
    const a = accounts.find(a => a.id === id);
    return a ? `${a.codice} — ${a.nome}` : null;
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Fornitore</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map(s => (
          <Card key={s.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2 gap-2">
                <h3 className="font-medium text-sm">{s.ragione_sociale}</h3>
                <div className="flex items-center gap-1 shrink-0">
                  {!s.attivo && <Badge variant="secondary" className="text-xs">Disattivo</Badge>}
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifica" onClick={() => openEdit(s)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {s.tipo_soggetto ? (
                  <Badge variant="outline" className="text-xs">{TIPI_SOGGETTO[s.tipo_soggetto]?.label || s.tipo_soggetto}</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                    <AlertTriangle className="w-3 h-3 mr-1" /> Tipo non indicato
                  </Badge>
                )}
                {s.regime_forfettario && <Badge variant="outline" className="text-xs">Forfettario</Badge>}
                {ritenutaDovuta(s) && (
                  <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                    <Receipt className="w-3 h-3 mr-1" /> Ritenuta {Number(s.aliquota_ritenuta) || ALIQUOTA_RITENUTA_ORDINARIA}%
                  </Badge>
                )}
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

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? `Modifica ${editing.ragione_sociale}` : "Nuovo fornitore"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><Label>Ragione sociale *</Label><Input required value={form.ragione_sociale} onChange={e => setForm({...form, ragione_sociale: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>P.IVA/CF</Label><Input value={form.piva_cf} onChange={e => setForm({...form, piva_cf: e.target.value})} /></div>
              <div><Label>IBAN</Label><Input value={form.iban} onChange={e => setForm({...form, iban: e.target.value})} /></div>
            </div>

            {/* Dal tipo di soggetto dipende se il pagamento è soggetto a ritenuta. */}
            <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/30">
              <div>
                <Label>Tipo di soggetto *</Label>
                <Select value={form.tipo_soggetto || "none"} onValueChange={v => setForm({...form, tipo_soggetto: v === "none" ? "" : v})}>
                  <SelectTrigger><SelectValue placeholder="Da indicare" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Da indicare</SelectItem>
                    {Object.entries(TIPI_SOGGETTO).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.tipo_soggetto && (
                  <p className="text-xs text-muted-foreground mt-1">{TIPI_SOGGETTO[form.tipo_soggetto].descrizione}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="forfettario"
                  checked={form.regime_forfettario}
                  onCheckedChange={c => setForm({...form, regime_forfettario: !!c})}
                />
                <Label htmlFor="forfettario" className="font-normal cursor-pointer">Applica il regime forfettario</Label>
              </div>

              {ritenutaDovuta(anteprimaFornitore) ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-xs text-purple-800">
                    <Receipt className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>I pagamenti a questo fornitore sono soggetti a ritenuta d'acconto: una quota del compenso va versata all'erario, non al fornitore.</span>
                  </div>
                  <div>
                    <Label className="text-xs">Aliquota ritenuta (%)</Label>
                    <Input
                      type="number" step="0.01" className="w-28"
                      value={form.aliquota_ritenuta}
                      placeholder={String(ALIQUOTA_RITENUTA_ORDINARIA)}
                      onChange={e => setForm({...form, aliquota_ritenuta: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Vuoto: si applica l'aliquota ordinaria del {ALIQUOTA_RITENUTA_ORDINARIA}%.</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{motivoEsenzione(anteprimaFornitore)}</p>
              )}
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
            <Button type="submit" className="w-full">{editing ? "Salva modifiche" : "Crea fornitore"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}