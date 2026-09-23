import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Plus, Pencil } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";

// Categorie e istruttori si creavano anche da qui, in due finestre appese al catalogo, mentre
// hanno una pagina ciascuna nella stessa barra in alto. Due porte per la stessa stanza: una
// categoria creata di lato non compariva nell'elenco che si stava guardando, e nessuna delle due
// finestre permetteva di correggere quello che si era appena scritto. Chi non trova la categoria
// che gli serve la crea nella sua pagina, e torna qui.
export default function CoursesTab({ data, reload }) {
  const { courses, categories, instructors } = data;
  const { toast } = useToast();
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", category_id: "", instructor_id: "", description: "" });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", category_id: "", instructor_id: "", description: "" });
    setShowCourseForm(true);
  };

  const openEdit = (course) => {
    setEditing(course);
    setForm({
      name: course.name || "",
      category_id: course.category_id || "",
      instructor_id: course.instructor_id || "",
      description: course.description || "",
    });
    setShowCourseForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id || !form.instructor_id) return;
    const payload = { ...form };
    try {
      if (editing) {
        await api.entities.Course.update(editing.id, payload);
        toast({ title: "Corso aggiornato" });
      } else {
        await api.entities.Course.create(payload);
        toast({ title: "Corso creato" });
      }
      setShowCourseForm(false);
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const catName = (id) => categories.find(c => c.id === id)?.name || "—";
  const instName = (id) => instructors.find(i => i.id === id)?.full_name || "—";

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo corso</Button>

      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessun corso. Un corso ha una categoria e un istruttore: si preparano nelle loro pagine, qui sopra.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map(course => (
            <Card key={course.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium">{course.name}</h4>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Modifica ${course.name}`} onClick={() => openEdit(course)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>Categoria: <span className="text-foreground font-medium">{catName(course.category_id)}</span></div>
                  <div>Istruttore: <span className="text-foreground font-medium">{instName(course.instructor_id)}</span></div>
                  {course.description && <p className="mt-2">{course.description}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog: crea/modifica corso */}
      <Dialog open={showCourseForm} onOpenChange={setShowCourseForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Modifica corso" : "Nuovo corso"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Categoria *</Label>
              <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona categoria" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {categories.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessuna categoria: creala nella pagina Categorie.</p>}
            </div>
            <div>
              <Label>Istruttore *</Label>
              <Select value={form.instructor_id} onValueChange={v => setForm({ ...form, instructor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona istruttore" /></SelectTrigger>
                <SelectContent>
                  {instructors.map(i => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {instructors.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessun istruttore: registralo nella pagina Istruttori.</p>}
            </div>

            <div><Label>Descrizione</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.name.trim() || !form.category_id || !form.instructor_id}>
              {editing ? "Salva" : "Crea corso"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
