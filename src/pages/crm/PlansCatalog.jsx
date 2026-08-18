import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Edit2, Trash2, Clock, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function PlansCatalog() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", price: "", duration_days: "", sessions_included: "", description: "" });

  const loadData = () => {
    api.entities.Plan.list().then(p => { setPlans(p); setLoading(false); });
  };
  useEffect(() => { loadData(); }, []);

  const openEdit = (plan) => {
    setEditing(plan);
    setForm({ name: plan.name, price: plan.price, duration_days: plan.duration_days, sessions_included: plan.sessions_included || "", description: plan.description || "" });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = { ...form, price: Number(form.price), duration_days: Number(form.duration_days), sessions_included: form.sessions_included ? Number(form.sessions_included) : 999, is_active: true };
    if (editing) {
      await api.entities.Plan.update(editing.id, data);
    } else {
      await api.entities.Plan.create(data);
    }
    setShowForm(false);
    setEditing(null);
    setForm({ name: "", price: "", duration_days: "", sessions_included: "", description: "" });
    loadData();
  };

  const handleDelete = async (id) => {
    await api.entities.Plan.delete(id);
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Catalogo abbonamenti" description="Tipi di abbonamento e pacchetti">
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", price: "", duration_days: "", sessions_included: "", description: "" }); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nuovo abbonamento
        </Button>
      </PageHeader>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map(plan => (
          <Card key={plan.id} className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-heading font-semibold">{plan.name}</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(plan)}><Edit2 className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(plan.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <p className="text-2xl font-bold text-primary">€{plan.price}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {plan.duration_days} giorni</span>
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {plan.sessions_included >= 999 ? "Illimitate" : `${plan.sessions_included} sessioni`}</span>
              </div>
              {plan.description && <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? "Modifica abbonamento" : "Nuovo abbonamento"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Prezzo (€) *</Label><Input type="number" required value={form.price} onChange={e => setForm({...form, price: e.target.value})} /></div>
              <div><Label>Durata (giorni) *</Label><Input type="number" required value={form.duration_days} onChange={e => setForm({...form, duration_days: e.target.value})} /></div>
            </div>
            <div><Label>Sessioni incluse</Label><Input type="number" value={form.sessions_included} onChange={e => setForm({...form, sessions_included: e.target.value})} placeholder="Lascia vuoto per illimitate" /></div>
            <div><Label>Descrizione</Label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <Button type="submit" className="w-full">{editing ? "Aggiorna" : "Crea"} abbonamento</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}