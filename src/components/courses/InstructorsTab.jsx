import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Mail, Phone } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function InstructorsTab({ data, reload }) {
  const { instructors } = data;
  const { toast } = useToast();
  const [form, setForm] = useState({ full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" });

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    try {
      await base44.entities.Instructor.create(form);
      toast({ title: "Istruttore creato" });
      setForm({ full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Nome completo *</Label><Input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>P.IVA / Cod. Fiscale</Label><Input value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} /></div>
            </div>
            <div><Label>Note</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <Button type="submit" size="sm"><Plus className="w-4 h-4 mr-1" /> Aggiungi istruttore</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {instructors.map(i => (
          <Card key={i.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h4 className="font-medium">{i.full_name}</h4>
              {i.contact_email && <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Mail className="w-3 h-3" /> {i.contact_email}</p>}
              {i.contact_phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> {i.contact_phone}</p>}
              {i.notes && <p className="text-xs text-muted-foreground mt-2">{i.notes}</p>}
            </CardContent>
          </Card>
        ))}
        {instructors.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun istruttore</p>}
      </div>
    </div>
  );
}