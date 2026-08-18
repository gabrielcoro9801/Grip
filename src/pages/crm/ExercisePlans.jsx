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
import { Plus, Trash2, Dumbbell } from "lucide-react";
import moment from "moment";

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const member = members.find(m => m.id === form.member_id);
    await api.entities.ExercisePlan.create({
      ...form,
      member_name: member?.full_name || "",
      assigned_date: new Date().toISOString().split("T")[0],
    });
    setShowForm(false);
    setForm({ member_id: "", name: "", notes: "", exercises: [] });
    loadData();
  };

  const handleNewExercise = async (e) => {
    e.preventDefault();
    await api.entities.Exercise.create(exForm);
    setShowExLib(false);
    setExForm({ name: "", muscle_group: "Chest", default_sets: 3, default_reps: "10" });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Piani di Allenamento" description="Crea e assegna piani di allenamento">
        <Button size="sm" variant="outline" onClick={() => setShowExLib(true)}>
          <Plus className="w-4 h-4 mr-1" /> Aggiungi alla Libreria
        </Button>
        <Button size="sm" onClick={() => { setForm({ member_id: "", name: "", notes: "", exercises: [] }); setShowForm(true); }}>
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

      {/* Plans Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map(plan => {
          const stats = getMemberStats(plan.member_id);
          return (
          <Card key={plan.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <h3 className="font-heading font-semibold">{plan.name}</h3>
              <p className="text-xs text-muted-foreground">{plan.member_name} · {moment(plan.assigned_date).format("D MMM YYYY")}</p>
              <p className="text-xs text-muted-foreground mb-3">Sessioni registrate: {stats.count}{stats.lastDate ? ` · Ultima: ${moment(stats.lastDate).format("D MMM YYYY")}` : ""}</p>
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

      {/* New Plan Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo Piano di Allenamento</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label>Socio *</Label>
              <Select value={form.member_id} onValueChange={v => setForm({...form, member_id: v})}>
                <SelectTrigger><SelectValue placeholder="Seleziona socio" /></SelectTrigger>
                <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}</SelectContent>
              </Select>
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
            <Button type="submit" className="w-full" disabled={!form.member_id || !form.name}>Crea Piano</Button>
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