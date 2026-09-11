import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Plus, Mail, Phone, Pencil, X } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";

const emptyForm = { full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" };

export default function InstructorsTab({ data, reload }) {
  const { instructors } = data;
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const startEdit = (instructor) => {
    setEditing(instructor);
    setForm({
      full_name: instructor.full_name || "",
      tax_id: instructor.tax_id || "",
      contact_email: instructor.contact_email || "",
      contact_phone: instructor.contact_phone || "",
      notes: instructor.notes || "",
    });
  };

  const cancelEdit = () => { setEditing(null); setForm(emptyForm); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    try {
      if (editing) {
        await api.entities.Instructor.update(editing.id, form);
        toast({ title: "Istruttore aggiornato" });
      } else {
        await api.entities.Instructor.create(form);
        toast({ title: "Istruttore creato" });
      }
      cancelEdit();
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Nome completo *</Label><Input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>P.IVA / Cod. Fiscale</Label><Input value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} /></div>
            </div>

            <div><Label>Note</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                {editing ? "Salva modifiche" : <><Plus className="w-4 h-4 mr-1" /> Aggiungi istruttore</>}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                  <X className="w-4 h-4 mr-1" /> Annulla
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {instructors.map(i => (
          <Card key={i.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium">{i.full_name}</h4>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Modifica" onClick={() => startEdit(i)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
              {i.tax_id && <p className="text-xs text-muted-foreground mt-1.5">{i.tax_id}</p>}
              {i.contact_email && <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Mail className="w-3 h-3" /> {i.contact_email}</p>}
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
