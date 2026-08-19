import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Mail, Phone, Pencil, X, Users, Briefcase, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const emptyForm = { full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "", collaboratore_id: "", fornitore_id: "" };

const NESSUNO = "none";

export default function InstructorsTab({ data, reload }) {
  const { instructors, collaboratori = [], fornitori = [] } = data;
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const collaboratoreById = new Map(collaboratori.map(c => [c.id, c]));
  const fornitoreById = new Map(fornitori.map(f => [f.id, f]));

  const startEdit = (instructor) => {
    setEditing(instructor);
    setForm({
      full_name: instructor.full_name || "",
      tax_id: instructor.tax_id || "",
      contact_email: instructor.contact_email || "",
      contact_phone: instructor.contact_phone || "",
      notes: instructor.notes || "",
      collaboratore_id: instructor.collaboratore_id || "",
      fornitore_id: instructor.fornitore_id || "",
    });
  };

  const cancelEdit = () => { setEditing(null); setForm(emptyForm); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    const payload = {
      ...form,
      collaboratore_id: form.collaboratore_id || null,
      fornitore_id: form.fornitore_id || null,
    };
    try {
      if (editing) {
        await api.entities.Instructor.update(editing.id, payload);
        toast({ title: "Istruttore aggiornato" });
      } else {
        await api.entities.Instructor.create(payload);
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

            {/* Da questi due collegamenti dipende come viene pagato chi tiene il corso:
                col compenso periodico se fa parte del team, contro fattura se è un
                professionista esterno. Possono valere entrambi per la stessa persona. */}
            <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border/50">
              <div>
                <Label className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Persona del team</Label>
                <Select
                  value={form.collaboratore_id || NESSUNO}
                  onValueChange={v => setForm({ ...form, collaboratore_id: v === NESSUNO ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Non fa parte del team" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NESSUNO}>Non fa parte del team</SelectItem>
                    {collaboratori.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome} {c.cognome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Le ore confluiscono nel compenso periodico.</p>
              </div>
              <div>
                <Label className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Fornitore esterno</Label>
                <Select
                  value={form.fornitore_id || NESSUNO}
                  onValueChange={v => setForm({ ...form, fornitore_id: v === NESSUNO ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Non è un fornitore" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NESSUNO}>Non è un fornitore</SelectItem>
                    {fornitori.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">La prestazione si paga contro fattura.</p>
              </div>
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
        {instructors.map(i => {
          const collaboratore = i.collaboratore_id ? collaboratoreById.get(i.collaboratore_id) : null;
          const fornitore = i.fornitore_id ? fornitoreById.get(i.fornitore_id) : null;
          return (
            <Card key={i.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium">{i.full_name}</h4>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Modifica" onClick={() => startEdit(i)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {collaboratore && (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                      <Users className="w-3 h-3 mr-1" /> Team · {collaboratore.nome} {collaboratore.cognome}
                    </Badge>
                  )}
                  {fornitore && (
                    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                      <Briefcase className="w-3 h-3 mr-1" /> Fornitore · {fornitore.ragione_sociale}
                    </Badge>
                  )}
                </div>
                {!collaboratore && !fornitore && (
                  <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Non collegato: non si sa come vada retribuito.
                  </p>
                )}
                {i.contact_email && <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Mail className="w-3 h-3" /> {i.contact_email}</p>}
                {i.contact_phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> {i.contact_phone}</p>}
                {i.notes && <p className="text-xs text-muted-foreground mt-2">{i.notes}</p>}
              </CardContent>
            </Card>
          );
        })}
        {instructors.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun istruttore</p>}
      </div>
    </div>
  );
}
