import React, { useState } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Plus, Mail, Phone, Pencil, Trash2, X, Power, PowerOff } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";

const emptyForm = { full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" };

export default function InstructorsTab({ data, reload }) {
  const { instructors, courses } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
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

  // Un istruttore si elimina finché nessun corso lo cita: dopo, il corso resterebbe senza chi
  // lo tiene, e il calendario passato senza il nome di chi c'era.
  const elimina = async (istruttore) => {
    const suoi = courses.filter((c) => c.instructor_id === istruttore.id).length;
    if (suoi) {
      toast({
        title: "Questo istruttore non si può eliminare",
        description: `Tiene ${suoi} ${suoi === 1 ? "corso" : "corsi"}: assegnali a un altro istruttore, oppure disattivalo — resta nello storico e non si propone più.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({ title: `Eliminare «${istruttore.full_name}»?`, confirmLabel: "Elimina", destructive: true });
    if (!ok) return;
    try {
      await api.entities.Instructor.delete(istruttore.id);
      if (editing?.id === istruttore.id) cancelEdit();
      toast({ title: "Istruttore eliminato" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

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


  // Chi ha uno storico non si elimina: si disattiva, e sparisce dalle scelte per il futuro.
  const cambiaAttivo = async (riga, attivo) => {
    try {
      await api.entities.Instructor.update(riga.id, { attivo });
      toast({ title: attivo ? "Istruttore riattivato" : "Istruttore disattivato" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  // I disattivati in fondo: si consultano, ma non sono quelli con cui si lavora.
  const elenco = [...instructors].sort((a, b) => Number(b.attivo !== false) - Number(a.attivo !== false));

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
        {elenco.map(i => (
          <Card key={i.id} className={`border-0 shadow-sm ${i.attivo === false ? "opacity-70" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-medium">{i.full_name}</h4>
                  {i.attivo === false && <p className="text-xs text-muted-foreground">Disattivato</p>}
                </div>
                {puoModificare && (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-9 w-9" title="Modifica" aria-label={`Modifica ${i.full_name}`} onClick={() => startEdit(i)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-9 w-9"
                      title={i.attivo === false ? "Riattiva" : "Disattiva"}
                      aria-label={`${i.attivo === false ? "Riattiva" : "Disattiva"} ${i.full_name}`}
                      onClick={() => cambiaAttivo(i, i.attivo === false)}
                    >
                      {i.attivo === false ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" title="Elimina" aria-label={`Elimina ${i.full_name}`} onClick={() => elimina(i)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
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
      {dialogoConferma}
    </div>
  );
}
