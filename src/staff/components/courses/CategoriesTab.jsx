import React, { useState } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { EmptyState } from "@/ui/StateViews";
import { Plus, Pencil, Trash2, Tags } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";

const VUOTO = { name: "", color: "#3b82f6" };

// Una categoria si aggiunge e si corregge da una finestra, come corsi, sale e istruttori: il
// modulo sempre aperto in cima alla pagina era l'unico della sezione. Si elimina finché nessun
// corso la usa — dopo, toglierla lascerebbe quei corsi senza gruppo e senza colore.
export default function CategoriesTab({ data, reload }) {
  const { categories, courses } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(VUOTO);
  const [salvando, setSalvando] = useState(false);

  const apriCreazione = () => { setEditing(null); setForm(VUOTO); setShowForm(true); };
  const apriModifica = (c) => { setEditing(c); setForm({ name: c.name || "", color: c.color || VUOTO.color }); setShowForm(true); };

  const salva = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    setSalvando(true);
    try {
      if (editing) {
        await api.entities.Category.update(editing.id, { name, color: form.color });
        toast({ title: "Categoria aggiornata" });
      } else {
        await api.entities.Category.create({ name, color: form.color });
        toast({ title: "Categoria creata" });
      }
      setShowForm(false);
      setForm(VUOTO);
      reload();
    } catch (err) {
      toast({ title: "Categoria non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
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
      toast({ title: "Categoria eliminata" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {dialogoConferma}
      {puoModificare && (
        <Button size="sm" onClick={apriCreazione}><Plus className="w-4 h-4 mr-1" /> Nuova categoria</Button>
      )}

      {categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Nessuna categoria"
          description="Come si raggruppano i corsi: servono a ritrovarli e a dargli un colore in calendario."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map(c => (
            <Card key={c.id} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: c.color || "#ccc" }} />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium truncate" title={c.name}>{c.name}</h4>
                  <p className="text-xs text-muted-foreground">{courseCount(c.id)} corsi collegati</p>
                </div>
                {puoModificare && (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Modifica ${c.name}`} onClick={() => apriModifica(c)}>
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
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? "Modifica categoria" : "Nuova categoria"}</DialogTitle></DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            <div>
              <Label htmlFor="categoria-nome">Nome *</Label>
              <Input id="categoria-nome" required maxLength={255} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="categoria-colore">Colore in calendario</Label>
              <Input id="categoria-colore" type="color" className="w-16 p-1 h-9" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={!form.name.trim() || salvando}>
              {salvando ? "Salvataggio..." : editing ? "Salva categoria" : "Crea categoria"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
