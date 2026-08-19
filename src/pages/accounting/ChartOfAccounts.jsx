import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Lock, Pencil, Trash2, Eye, EyeOff, AlertCircle } from "lucide-react";

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
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ codice: "", nome: "", tipo_conto: "attivo", natura: "dare", conto_padre_id: "", gestisce_iva: false });

  const loadAccounts = (orgId) => {
    api.entities.ChartOfAccount.filter({ organization_id: orgId }, "codice").then(a => { setAccounts(a); setLoading(false); });
  };

  useEffect(() => {
    if (organization) loadAccounts(organization.id);
  }, [organization]);

  const filtered = useMemo(() => {
    return filterTipo === "tutti" ? accounts : accounts.filter(a => a.tipo_conto === filterTipo);
  }, [accounts, filterTipo]);

  const roots = filtered.filter(a => !a.conto_padre_id);
  const getChildren = (id) => filtered.filter(a => a.conto_padre_id === id);

  const emptyForm = { codice: "", nome: "", tipo_conto: "attivo", natura: "dare", conto_padre_id: "", gestisce_iva: false };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setError(""); setShowForm(true); };

  const openEdit = (acc) => {
    setEditing(acc);
    setForm({
      codice: acc.codice, nome: acc.nome, tipo_conto: acc.tipo_conto,
      natura: acc.natura, conto_padre_id: acc.conto_padre_id || "",
      gestisce_iva: !!acc.gestisce_iva,
    });
    setError("");
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { ...form, conto_padre_id: form.conto_padre_id || null };
    try {
      if (editing) {
        await api.entities.ChartOfAccount.update(editing.id, payload);
      } else {
        await api.entities.ChartOfAccount.create({
          ...payload, organization_id: organization.id, sistema: false, attivo: true,
        });
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      loadAccounts(organization.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (acc) => {
    setError("");
    // Un conto con sottoconti non può sparire senza lasciarli orfani: prima vanno
    // spostati o eliminati loro.
    if (accounts.some(a => a.conto_padre_id === acc.id)) {
      setError(`"${acc.nome}" ha dei sottoconti: eliminali o spostali prima di procedere.`);
      return;
    }
    try {
      await api.entities.ChartOfAccount.delete(acc.id);
      loadAccounts(organization.id);
    } catch (err) {
      // Il database rifiuta l'eliminazione se il conto è già stato movimentato: in quel
      // caso il conto va disattivato, non cancellato, o si perderebbe la storia contabile.
      setError(`"${acc.nome}" non può essere eliminato: è già usato in una registrazione. Puoi disattivarlo.`);
    }
  };

  const toggleAttivo = async (acc) => {
    setError("");
    try {
      await api.entities.ChartOfAccount.update(acc.id, { attivo: !acc.attivo });
      loadAccounts(organization.id);
    } catch (err) {
      setError(err.message);
    }
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
            {/* I conti di sistema sono quelli su cui il motore contabile fa affidamento
                per codice (cassa, IVA, crediti…): rinominarli o eliminarli farebbe
                fallire la generazione delle scritture, quindi restano bloccati. */}
            {acc.sistema ? (
              <span className="w-[88px]" />
            ) : (
              <div className="flex items-center gap-1 w-[88px] justify-end">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifica" onClick={() => openEdit(acc)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title={acc.attivo ? "Disattiva" : "Riattiva"} onClick={() => toggleAttivo(acc)}>
                  {acc.attivo ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Elimina" onClick={() => handleDelete(acc)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
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
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo conto</Button>
      </PageHeader>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        {roots.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun conto trovato</p>
        ) : roots.map(a => renderAccount(a))}
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? `Modifica conto ${editing.codice}` : "Nuovo conto"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
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
                  {/* Un conto non può essere padre di sé stesso. */}
                  {accounts.filter(a => a.id !== editing?.id).map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="gestisce_iva" checked={form.gestisce_iva} onCheckedChange={c => setForm({...form, gestisce_iva: !!c})} />
              <Label htmlFor="gestisce_iva" className="font-normal">Gestisce IVA</Label>
            </div>
            <Button type="submit" className="w-full">{editing ? "Salva modifiche" : "Crea conto"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}