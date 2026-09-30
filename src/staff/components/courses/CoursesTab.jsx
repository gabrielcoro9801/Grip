import React, { useState } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Plus, Pencil, Trash2, Power, PowerOff } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import { NOTE_CORSO_MASSIMO } from "@/core/domain/corsi";

// Categorie e istruttori si creavano anche da qui, in due finestre appese al catalogo, mentre
// hanno una pagina ciascuna nella stessa barra in alto. Due porte per la stessa stanza: una
// categoria creata di lato non compariva nell'elenco che si stava guardando, e nessuna delle due
// finestre permetteva di correggere quello che si era appena scritto. Chi non trova la categoria
// che gli serve la crea nella sua pagina, e torna qui.
export default function CoursesTab({ data, reload }) {
  const { courses, categories, instructors, events } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
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

  // Le note stanno in tre righe della tile. Quelle scritte prima del limite possono superarlo:
  // si leggono intere nella finestra, e per salvare vanno accorciate.
  const noteTroppoLunghe = form.description.length > NOTE_CORSO_MASSIMO;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.category_id || !form.instructor_id || noteTroppoLunghe) return;
    const payload = { ...form, description: form.description.trim() || null };
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

  // Un corso si elimina solo se non è mai andato in calendario: i suoi eventi portano con sé
  // lezioni e prenotazioni, e toglierlo cancellerebbe il "cosa" di lezioni già fatte.
  const elimina = async (course) => {
    const suoi = events.filter((ev) => ev.course_id === course.id).length;
    if (suoi) {
      toast({
        title: "Questo corso non si può eliminare",
        description: `È in calendario con ${suoi} ${suoi === 1 ? "evento" : "eventi"}: resta nel catalogo con il suo storico. Se non si terrà più, disattivalo.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({ title: `Eliminare «${course.name}»?`, confirmLabel: "Elimina", destructive: true });
    if (!ok) return;
    try {
      await api.entities.Course.delete(course.id);
      toast({ title: "Corso eliminato" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

// Chi ha uno storico non si elimina: si disattiva, e sparisce dalle scelte per il futuro.
  const cambiaAttivo = async (riga, attivo) => {
    try {
      await api.entities.Course.update(riga.id, { attivo });
      toast({ title: attivo ? "Corso riattivato" : "Corso disattivato" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  // A un corso si assegna un istruttore attivo; quello che ha già resta fra le scelte.
  const istruttoriSceglibili = instructors.filter((i) => i.attivo !== false || i.id === form.instructor_id);
  const elenco = [...courses].sort((a, b) => Number(b.attivo !== false) - Number(a.attivo !== false));

  const catName = (id) => categories.find(c => c.id === id)?.name || "—";
  const instName = (id) => instructors.find(i => i.id === id)?.full_name || "—";

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo corso</Button>

      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessun corso. Un corso ha una categoria e un istruttore: si preparano nelle loro pagine, qui sopra.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {elenco.map(course => (
            <Card key={course.id} className={`border-0 shadow-sm min-w-0 ${course.attivo === false ? "opacity-70" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <h4 className="font-medium truncate" title={course.name}>{course.name}</h4>
                    {course.attivo === false && <p className="text-xs text-muted-foreground">Disattivato: non si programma più</p>}
                  </div>
                  {puoModificare && (
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Modifica ${course.name}`} onClick={() => openEdit(course)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-9 w-9"
                        title={course.attivo === false ? "Riattiva" : "Disattiva"}
                        aria-label={`${course.attivo === false ? "Riattiva" : "Disattiva"} ${course.name}`}
                        onClick={() => cambiaAttivo(course, course.attivo === false)}
                      >
                        {course.attivo === false ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Elimina ${course.name}`} onClick={() => elimina(course)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground min-w-0">
                  <div className="truncate">Categoria: <span className="text-foreground font-medium">{catName(course.category_id)}</span></div>
                  <div className="truncate">Istruttore: <span className="text-foreground font-medium">{instName(course.instructor_id)}</span></div>
                  {/* Le note stanno in tre righe: una parola lunga va a capo invece di uscire dalla
                      tile, e il testo che c'era prima del limite si legge intero passandoci sopra. */}
                  {course.description && (
                    <p className="mt-2 line-clamp-3 break-words [overflow-wrap:anywhere]" title={course.description}>{course.description}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogoConferma}

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
                  {istruttoriSceglibili.map(i => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {instructors.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessun istruttore: registralo nella pagina Istruttori.</p>}
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="corso-note">Note</Label>
                <span className={`text-xs tabular-nums ${noteTroppoLunghe ? "text-destructive" : "text-muted-foreground"}`}>{form.description.length}/{NOTE_CORSO_MASSIMO}</span>
              </div>
              <Textarea
                id="corso-note" rows={3} maxLength={NOTE_CORSO_MASSIMO} className="resize-none"
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              />
              {noteTroppoLunghe && <p className="text-xs text-destructive mt-1">Le note sono state scritte prima del limite: accorciale a {NOTE_CORSO_MASSIMO} caratteri per salvare.</p>}
            </div>
            <Button type="submit" className="w-full" disabled={!form.name.trim() || !form.category_id || !form.instructor_id || noteTroppoLunghe}>
              {editing ? "Salva" : "Crea corso"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
