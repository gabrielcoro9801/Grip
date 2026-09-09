import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { formatEuro } from "@/lib/format";

const emptyForm = { anno_esercizio: new Date().getFullYear(), data_inizio_esercizio: "", data_fine_esercizio: "", proventi_commerciali: "", proventi_complessivi: "", note: "" };

export default function FiscalYearTable({ organization, years, onRefresh }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setForm({ ...emptyForm, anno_esercizio: new Date().getFullYear() }); setShowForm(true); };
  const openEdit = (y) => {
    setEditing(y);
    setForm({
      anno_esercizio: y.anno_esercizio || "",
      data_inizio_esercizio: y.data_inizio_esercizio || "",
      data_fine_esercizio: y.data_fine_esercizio || "",
      proventi_commerciali: y.proventi_commerciali ?? "",
      proventi_complessivi: y.proventi_complessivi ?? "",
      note: y.note || "",
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        organization_id: organization.id,
        anno_esercizio: form.anno_esercizio === "" ? null : Number(form.anno_esercizio),
        proventi_commerciali: form.proventi_commerciali === "" ? null : Number(form.proventi_commerciali),
        proventi_complessivi: form.proventi_complessivi === "" ? null : Number(form.proventi_complessivi),
      };
      if (editing) {
        await api.entities.FiscalYearData.update(editing.id, payload);
        toast({ title: "Dati esercizio aggiornati" });
      } else {
        await api.entities.FiscalYearData.create(payload);
        toast({ title: "Dati esercizio registrati" });
      }
      setShowForm(false);
      onRefresh();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleDelete = async (y) => {
    if (!confirm(`Eliminare i dati dell'esercizio ${y.anno_esercizio}?`)) return;
    await api.entities.FiscalYearData.delete(y.id);
    toast({ title: "Dati eliminati" });
    onRefresh();
  };

  const sorted = [...years].sort((a, b) => (b.anno_esercizio || 0) - (a.anno_esercizio || 0));
  const fmtEur = (val) => val != null ? `${formatEuro(Number(val))}` : "—";

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-heading">Dati economici per esercizio</CardTitle>
        <Button size="sm" variant="outline" onClick={openNew}><Plus className="w-3 h-3 mr-1" /> Aggiungi esercizio</Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nessun dato economico registrato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Anno</th>
                  <th className="py-2 font-medium">Proventi commerciali</th>
                  <th className="py-2 font-medium">Proventi complessivi</th>
                  <th className="py-2 font-medium">Note</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(y => (
                  <tr key={y.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{y.anno_esercizio || "—"}</td>
                    <td className="py-2">{fmtEur(y.proventi_commerciali)}</td>
                    <td className="py-2">{fmtEur(y.proventi_complessivi)}</td>
                    <td className="py-2 text-muted-foreground max-w-xs truncate">{y.note || "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(y)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(y)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={showForm} onOpenChange={(v) => !v && setShowForm(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Modifica dati esercizio" : "Aggiungi dati esercizio"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Anno esercizio</Label><Input type="number" value={form.anno_esercizio} onChange={e => setForm(f => ({ ...f, anno_esercizio: e.target.value }))} /></div>
              <div><Label>Data inizio esercizio</Label><Input type="date" value={form.data_inizio_esercizio} onChange={e => setForm(f => ({ ...f, data_inizio_esercizio: e.target.value }))} /></div>
            </div>
            <div><Label>Data fine esercizio</Label><Input type="date" value={form.data_fine_esercizio} onChange={e => setForm(f => ({ ...f, data_fine_esercizio: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Proventi commerciali (€)</Label><Input type="number" step="0.01" value={form.proventi_commerciali} onChange={e => setForm(f => ({ ...f, proventi_commerciali: e.target.value }))} /></div>
              <div><Label>Proventi complessivi (€)</Label><Input type="number" step="0.01" value={form.proventi_complessivi} onChange={e => setForm(f => ({ ...f, proventi_complessivi: e.target.value }))} /></div>
            </div>
            <div><Label>Note</Label><Textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : "Salva"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}