import React, { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Tag, User, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function CoursesTab({ data, reload }) {
  const { courses, categories, instructors } = data;
  const { toast } = useToast();
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [showInstDialog, setShowInstDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", category_id: "", instructor_id: "", description: "" });
  const [catForm, setCatForm] = useState({ name: "", color: "#3b82f6" });
  const [instForm, setInstForm] = useState({ full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" });

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

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    await api.entities.Category.create(catForm);
    setCatForm({ name: "", color: "#3b82f6" });
    reload();
  };

  const handleCreateInstructor = async (e) => {
    e.preventDefault();
    if (!instForm.full_name.trim()) return;
    await api.entities.Instructor.create(instForm);
    setInstForm({ full_name: "", tax_id: "", contact_email: "", contact_phone: "", notes: "" });
    reload();
  };

  const catName = (id) => categories.find(c => c.id === id)?.name || "—";
  const instName = (id) => instructors.find(i => i.id === id)?.full_name || "—";

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo corso</Button>
        <Button size="sm" variant="outline" onClick={() => setShowCatDialog(true)}><Tag className="w-4 h-4 mr-1" /> Categorie</Button>
        <Button size="sm" variant="outline" onClick={() => setShowInstDialog(true)}><User className="w-4 h-4 mr-1" /> Istruttori</Button>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessun corso. Crea il primo corso o inizia da categorie e istruttori.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map(course => (
            <Card key={course.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium">{course.name}</h4>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(course)}>
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
              {categories.length === 0 && <p className="text-xs text-muted-foreground mt-1">Crea prima una categoria.</p>}
            </div>
            <div>
              <Label>Istruttore *</Label>
              <Select value={form.instructor_id} onValueChange={v => setForm({ ...form, instructor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona istruttore" /></SelectTrigger>
                <SelectContent>
                  {instructors.map(i => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {instructors.length === 0 && <p className="text-xs text-muted-foreground mt-1">Crea prima un istruttore.</p>}
            </div>

            <div><Label>Descrizione</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.name.trim() || !form.category_id || !form.instructor_id}>
              {editing ? "Salva" : "Crea corso"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: categorie */}
      <Dialog open={showCatDialog} onOpenChange={setShowCatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Categorie</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateCategory} className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nome categoria" required value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} />
              <Input type="color" className="w-12 p-1 h-9" value={catForm.color} onChange={e => setCatForm({ ...catForm, color: e.target.value })} />
              <Button type="submit" size="icon"><Plus className="w-4 h-4" /></Button>
            </div>
          </form>
          <div className="space-y-2 mt-2">
            {categories.map(c => (
              <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40">
                <div className="w-4 h-4 rounded" style={{ background: c.color || "#ccc" }} />
                <span className="text-sm">{c.name}</span>
              </div>
            ))}
            {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessuna categoria</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: istruttori */}
      <Dialog open={showInstDialog} onOpenChange={setShowInstDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Istruttori</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateInstructor} className="space-y-3">
            <div><Label>Nome completo *</Label><Input required value={instForm.full_name} onChange={e => setInstForm({ ...instForm, full_name: e.target.value })} /></div>
            <div><Label>P.IVA / Cod. Fiscale</Label><Input value={instForm.tax_id} onChange={e => setInstForm({ ...instForm, tax_id: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Email</Label><Input type="email" value={instForm.contact_email} onChange={e => setInstForm({ ...instForm, contact_email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={instForm.contact_phone} onChange={e => setInstForm({ ...instForm, contact_phone: e.target.value })} /></div>
            </div>
            <div><Label>Note</Label><Textarea value={instForm.notes} onChange={e => setInstForm({ ...instForm, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full"><Plus className="w-4 h-4 mr-1" /> Aggiungi istruttore</Button>
          </form>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {instructors.map(i => (
              <div key={i.id} className="p-2 rounded-lg bg-muted/40">
                <p className="text-sm font-medium">{i.full_name}</p>
                {i.contact_email && <p className="text-xs text-muted-foreground">{i.contact_email}</p>}
              </div>
            ))}
            {instructors.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessun istruttore</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}