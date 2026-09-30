import React, { useState } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";

const VUOTO = { name: "", color: "#3b82f6" };

// Una categoria si creava e basta: un nome scritto male o un colore che in calendario non si
// distingueva restavano per sempre. Ora si corregge, e si elimina finché nessun corso la usa —
// dopo, toglierla lascerebbe quei corsi senza gruppo e senza colore.
export default function CategoriesTab({ data, reload }) {
  const { categories, courses } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [form, setForm] = useState(VUOTO);
  const [editing, setEditing] = useState(null);

  const annullaModifica = () => { setEditing(null); setForm(VUOTO); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editing) {
        await api.entities.Category.update(editing.id, { name: form.name.trim(), color: form.color });
        toast({ title: "Categoria aggiornata" });
      } else {
        await api.entities.Category.create({ ...form, name: form.name.trim() });
        toast({ title: "Categoria creata" });
      }
      annullaModifica();
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const courseCount = (catId) => courses.filter(c => c.category_id === catId).length;

  const elimina = async (categoria) => {
    const quanti = courseCount(categoria.id);
    if (quanti) {
      toast({
        title: "Questa categoria non si può eliminare",
        description: `La usano ${quanti} ${quanti === 1 ? "corso" : "corsi"}: spostali in un'altra categoria, poi eliminala.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({ title: `Eliminare «${categoria.name}»?`, confirmLabel: "Elimina", destructive: true });
    if (!ok) return;
    try {
      await api.entities.Category.delete(categoria.id);
      if (editing?.id === categoria.id) annullaModifica();
      toast({ title: "Categoria eliminata" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {puoModificare && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label>{editing ? `Modifica «${editing.name}»` : "Nuova categoria"}</Label>
                <Input placeholder="Nome categoria" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Colore</Label>
                <Input type="color" className="w-16 p-1 h-9" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
              <Button type="submit" size="sm">
                {editing ? "Salva" : <><Plus className="w-4 h-4 mr-1" /> Crea</>}
              </Button>
              {editing && (
                <Button type="button" size="sm" variant="outline" onClick={annullaModifica}>
                  <X className="w-4 h-4 mr-1" /> Annulla
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map(c => (
          <Card key={c.id} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: c.color || "#ccc" }} />
              <div className="flex-1 min-w-0">
                <h4 className="font-medium truncate">{c.name}</h4>
                <p className="text-xs text-muted-foreground">{courseCount(c.id)} corsi collegati</p>
              </div>
              {puoModificare && (
                <div className="flex shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9" aria-label={`Modifica ${c.name}`}
                    onClick={() => { setEditing(c); setForm({ name: c.name || "", color: c.color || VUOTO.color }); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Elimina ${c.name}`} onClick={() => elimina(c)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessuna categoria</p>}
      </div>
      {dialogoConferma}
    </div>
  );
}
