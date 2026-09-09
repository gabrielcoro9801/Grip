import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Trash2, Dumbbell, Pencil, AlertCircle } from "lucide-react";
import moment from "moment";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData } from "@/lib/format";

export default function ExercisePlans() {
  const [plans, setPlans] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ member_id: "", name: "", notes: "", exercises: [] });
  const [showExLib, setShowExLib] = useState(false);
  const [workoutLogs, setWorkoutLogs] = useState([]);
  const [exForm, setExForm] = useState({ name: "", muscle_group: "Chest", default_sets: 3, default_reps: "10" });
  const [editing, setEditing] = useState(null);
  const [errore, setErrore] = useState("");

  const loadData = () => {
    Promise.all([
      api.entities.ExercisePlan.list(),
      api.entities.Exercise.list(),
      api.entities.Member.list(),
      api.entities.WorkoutLog.list(),
    ]).then(([p, e, m, wl]) => {
      setPlans(p); setExercises(e); setMembers(m); setWorkoutLogs(wl); setLoading(false);
    });
  };

  const getMemberStats = (memberId) => {
    const memberLogs = workoutLogs.filter(l => l.member_id === memberId);
    if (memberLogs.length === 0) return { count: 0, lastDate: null };
    const sorted = [...memberLogs].sort((a, b) => new Date(b.data) - new Date(a.data));
    return { count: memberLogs.length, lastDate: sorted[0].data };
  };
  useEffect(() => { loadData(); }, []);

  const addExerciseToPlan = (ex) => {
    setForm({
      ...form,
      exercises: [...form.exercises, {
        exercise_name: ex.name,
        muscle_group: ex.muscle_group,
        sets: ex.default_sets,
        reps: ex.default_reps,
        peso: null,
        rpe: null,
      }]
    });
  };

  const updateExerciseInPlan = (idx, field, value) => {
    setForm({
      ...form,
      exercises: form.exercises.map((ex, i) =>
        i === idx ? { ...ex, [field]: value } : ex
      )
    });
  };

  const removeExFromPlan = (idx) => {
    setForm({ ...form, exercises: form.exercises.filter((_, i) => i !== idx) });
  };

  const apriNuovo = () => {
    setEditing(null);
    setForm({ member_id: "", name: "", notes: "", exercises: [] });
    setErrore("");
    setShowForm(true);
  };

  const apriModifica = (plan) => {
    setEditing(plan);
    setForm({
      member_id: plan.member_id,
      name: plan.name,
      notes: plan.notes || "",
      // Copia profonda: senza, modificando serie o peso si toccherebbe l'oggetto già in
      // elenco, e annullando resterebbe a schermo il valore nuovo.
      exercises: (plan.exercises ?? []).map(ex => ({ ...ex })),
    });
    setErrore("");
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrore("");
    try {
      if (editing) {
        // Il socio non si cambia in modifica: gli allenamenti già registrati sono suoi e
        // resterebbero agganciati a un piano intestato a un altro. Per un'altra persona
        // si crea un piano nuovo.
        await api.entities.ExercisePlan.update(editing.id, {
          name: form.name,
          notes: form.notes,
          exercises: form.exercises,
        });
      } else {
        const member = members.find(m => m.id === form.member_id);
        await api.entities.ExercisePlan.create({
          ...form,
          member_name: member?.full_name || "",
          assigned_date: new Date().toISOString().split("T")[0],
        });
      }
      setShowForm(false);
      setEditing(null);
      setForm({ member_id: "", name: "", notes: "", exercises: [] });
      loadData();
    } catch (err) {
      setErrore(err.message);
    }
  };

  const handleDelete = async (plan) => {
    setErrore("");
    // Gli allenamenti registrati puntano al piano: eliminarlo cancellerebbe il filo che
    // lega una sessione a quello che il socio doveva fare quel giorno.
    const collegati = workoutLogs.filter(l => l.plan_id === plan.id).length;
    if (collegati > 0) {
      setErrore(`"${plan.name}" ha ${collegati} ${collegati === 1 ? "allenamento registrato" : "allenamenti registrati"} e non può essere eliminato: si perderebbe lo storico di ${plan.member_name}. Puoi però modificarlo.`);
      return;
    }
    if (!confirm(`Eliminare il piano "${plan.name}" di ${plan.member_name}?`)) return;
    try {
      await api.entities.ExercisePlan.delete(plan.id);
      loadData();
    } catch (err) {
      setErrore(err.message);
    }
  };

  const handleNewExercise = async (e) => {
    e.preventDefault();
    await api.entities.Exercise.create(exForm);
    setShowExLib(false);
    setExForm({ name: "", muscle_group: "Chest", default_sets: 3, default_reps: "10" });
    loadData();
  };

  if (loading) return <LoadingState minHeight="h-64" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Piani di Allenamento" description="Crea e assegna piani di allenamento">
        <Button size="sm" variant="outline" onClick={() => setShowExLib(true)}>
          <Plus className="w-4 h-4 mr-1" /> Aggiungi alla Libreria
        </Button>
        <Button size="sm" onClick={apriNuovo}>
          <Plus className="w-4 h-4 mr-1" /> Nuovo Piano
        </Button>
      </PageHeader>

      {/* Libreria Esercizi */}
      <div className="mb-6">
        <h3 className="text-sm font-heading font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Libreria Esercizi</h3>
        <div className="flex flex-wrap gap-2">
          {exercises.map(ex => (
            <span key={ex.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-xs font-medium">
              <Dumbbell className="w-3 h-3" /> {ex.name} <span className="text-muted-foreground">({ex.muscle_group})</span>
            </span>
          ))}
        </div>
      </div>

      {errore && !showForm && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errore}</span>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map(plan => {
          const stats = getMemberStats(plan.member_id);
          return (
          <Card key={plan.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-heading font-semibold">{plan.name}</h3>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifica piano" onClick={() => apriModifica(plan)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Elimina piano" onClick={() => handleDelete(plan)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{plan.member_name} · {formatData(plan.assigned_date, "media")}</p>
              <p className="text-xs text-muted-foreground mb-3">Sessioni registrate: {stats.count}{stats.lastDate ? ` · Ultima: ${formatData(stats.lastDate, "media")}` : ""}</p>
              <div className="space-y-1.5">
                {plan.exercises?.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/50">
                    <span className="font-medium">{ex.exercise_name}</span>
                    <span className="text-muted-foreground">
                      {ex.sets}×{ex.reps}
                      {ex.peso ? ` · ${ex.peso}kg` : ""}
                      {ex.rpe ? ` · RPE ${ex.rpe}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {plan.notes && <p className="text-xs text-muted-foreground mt-2 italic">{plan.notes}</p>}
            </CardContent>
          </Card>
          );
        })}
      </div>

      {/* Creazione e modifica di un piano: stessa finestra, stessi campi. */}
      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Modifica «${editing.name}»` : "Nuovo Piano di Allenamento"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {errore && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errore}</span>
              </div>
            )}
            <div>
              <Label>Socio *</Label>
              {/* In modifica il socio è bloccato: gli allenamenti già registrati sono suoi
                  e resterebbero agganciati a un piano intestato a un altro. */}
              <Select value={form.member_id} onValueChange={v => setForm({...form, member_id: v})} disabled={Boolean(editing)}>
                <SelectTrigger><SelectValue placeholder="Seleziona socio" /></SelectTrigger>
                <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}</SelectContent>
              </Select>
              {editing && (
                <p className="text-xs text-muted-foreground mt-1">
                  Un piano resta della persona a cui è stato assegnato. Per qualcun altro, creane uno nuovo.
                </p>
              )}
            </div>
            <div><Label>Nome Piano *</Label><Input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>

            <div>
              <Label className="mb-2 block">Esercizi</Label>
              <div className="space-y-2 mb-2">
                {form.exercises.map((ex, i) => (
                  <div key={i} className="p-2 rounded bg-muted/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{ex.exercise_name}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeExFromPlan(i)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Serie</Label>
                        <Input type="number" className="h-8 text-sm" value={ex.sets ?? ""} onChange={e => updateExerciseInPlan(i, "sets", e.target.value === "" ? null : Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Reps</Label>
                        <Input className="h-8 text-sm" value={ex.reps ?? ""} onChange={e => updateExerciseInPlan(i, "reps", e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Peso (kg)</Label>
                        <Input type="number" step="0.5" className="h-8 text-sm" value={ex.peso ?? ""} onChange={e => updateExerciseInPlan(i, "peso", e.target.value === "" ? null : Number(e.target.value))} placeholder="—" />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">RPE</Label>
                        <Input type="number" min="1" max="10" className="h-8 text-sm" value={ex.rpe ?? ""} onChange={e => updateExerciseInPlan(i, "rpe", e.target.value === "" ? null : Number(e.target.value))} placeholder="1-10" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {exercises.map(ex => (
                  <Button key={ex.id} type="button" variant="outline" size="sm" className="text-xs h-7" onClick={() => addExerciseToPlan(ex)}>
                    + {ex.name}
                  </Button>
                ))}
              </div>
            </div>

            <div><Label>Note</Label><Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            <Button type="submit" className="w-full" disabled={!form.member_id || !form.name}>
              {editing ? "Salva modifiche" : "Crea Piano"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Exercise Dialog */}
      <Dialog open={showExLib} onOpenChange={setShowExLib}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Aggiungi Esercizio alla Libreria</DialogTitle></DialogHeader>
          <form onSubmit={handleNewExercise} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={exForm.name} onChange={e => setExForm({...exForm, name: e.target.value})} /></div>
            <div>
              <Label>Gruppo Muscolare</Label>
              <Select value={exForm.muscle_group} onValueChange={v => setExForm({...exForm, muscle_group: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[["Chest", "Petto"], ["Back", "Schiena"], ["Shoulders", "Spalle"], ["Biceps", "Bicipiti"], ["Triceps", "Tricipiti"], ["Legs", "Gambe"], ["Core", "Core"], ["Full Body", "Corpo libero"], ["Cardio", "Cardio"]].map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Serie (default)</Label><Input type="number" value={exForm.default_sets} onChange={e => setExForm({...exForm, default_sets: Number(e.target.value)})} /></div>
              <div><Label>Reps (default)</Label><Input value={exForm.default_reps} onChange={e => setExForm({...exForm, default_reps: e.target.value})} /></div>
            </div>
            <Button type="submit" className="w-full">Aggiungi Esercizio</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}