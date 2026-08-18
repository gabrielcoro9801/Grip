import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Check } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

export default function MemberWorkoutPlans() {
  const { memberUser } = useMemberAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeForm, setActiveForm] = useState(null);
  const [logForm, setLogForm] = useState({
    peso_usato: "", reps_fatte: "", rpe_percepito: "",
    data: new Date().toISOString().split("T")[0], note: "",
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        api.entities.ExercisePlan.filter({ member_id: memberUser.member_id }),
        api.entities.WorkoutLog.filter({ member_id: memberUser.member_id }, "-data", 200),
      ]);
      setPlans(p);
      setLogs(l);
    } catch (err) {
      // ignore
    }
    setLoading(false);
  }, [memberUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const openForm = (plan, ex) => {
    setActiveForm(`${plan.id}__${ex.exercise_name}`);
    setLogForm({
      peso_usato: ex.peso ?? "",
      reps_fatte: "",
      rpe_percepito: ex.rpe ?? "",
      data: new Date().toISOString().split("T")[0],
      note: "",
    });
  };

  const handleSave = async (plan, ex) => {
    if (!logForm.data) {
      toast({ title: "Data obbligatoria", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.entities.WorkoutLog.create({
        member_id: memberUser.member_id,
        plan_id: plan.id,
        plan_name: plan.name,
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group || "",
        peso_usato: logForm.peso_usato === "" ? null : Number(logForm.peso_usato),
        reps_fatte: logForm.reps_fatte === "" ? null : Number(logForm.reps_fatte),
        rpe_percepito: logForm.rpe_percepito === "" ? null : Number(logForm.rpe_percepito),
        data: logForm.data,
        note: logForm.note,
      });
      toast({ title: "Esecuzione registrata" });
      setActiveForm(null);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const getExerciseLogs = (planId, exerciseName) =>
    logs.filter((l) => l.plan_id === planId && l.exercise_name === exerciseName);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Allenamento</h1>
        <p className="text-sm text-muted-foreground">I tuoi piani e registrazioni</p>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nessun piano assegnato</p>
      ) : (
        plans.map((plan) => (
          <Card key={plan.id} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="font-heading font-semibold">{plan.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Assegnato il {moment(plan.assigned_date).format("D MMM YYYY")}
                </p>
              </div>

              {plan.notes && (
                <p className="text-xs text-muted-foreground italic">{plan.notes}</p>
              )}

              <div className="space-y-2">
                {plan.exercises?.map((ex, i) => {
                  const formKey = `${plan.id}__${ex.exercise_name}`;
                  const exLogs = getExerciseLogs(plan.id, ex.exercise_name);
                  return (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{ex.exercise_name}</p>
                          <p className="text-xs text-muted-foreground">
                            Programma: {ex.sets}×{ex.reps}
                            {ex.peso ? ` · ${ex.peso}kg` : ""}
                            {ex.rpe ? ` · RPE ${ex.rpe}` : ""}
                          </p>
                        </div>
                        {activeForm !== formKey && (
                          <Button size="sm" variant="outline" onClick={() => openForm(plan, ex)}>
                            <ClipboardList className="w-3.5 h-3.5" /> Registra
                          </Button>
                        )}
                      </div>

                      {activeForm === formKey && (
                        <div className="space-y-2 p-2 rounded bg-background border border-border">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <Label className="text-[10px]">Peso (kg)</Label>
                              <Input type="number" step="0.5" className="h-8 text-sm"
                                value={logForm.peso_usato}
                                onChange={(e) => setLogForm({ ...logForm, peso_usato: e.target.value })}
                                placeholder="—" />
                            </div>
                            <div>
                              <Label className="text-[10px]">Reps fatte</Label>
                              <Input type="number" className="h-8 text-sm"
                                value={logForm.reps_fatte}
                                onChange={(e) => setLogForm({ ...logForm, reps_fatte: e.target.value })}
                                placeholder="—" />
                            </div>
                            <div>
                              <Label className="text-[10px]">RPE</Label>
                              <Input type="number" min="1" max="10" className="h-8 text-sm"
                                value={logForm.rpe_percepito}
                                onChange={(e) => setLogForm({ ...logForm, rpe_percepito: e.target.value })}
                                placeholder="1-10" />
                            </div>
                            <div>
                              <Label className="text-[10px]">Data</Label>
                              <Input type="date" className="h-8 text-sm"
                                value={logForm.data}
                                onChange={(e) => setLogForm({ ...logForm, data: e.target.value })} />
                            </div>
                          </div>
                          <div>
                            <Label className="text-[10px]">Note</Label>
                            <Textarea className="text-sm" rows={2}
                              value={logForm.note}
                              onChange={(e) => setLogForm({ ...logForm, note: e.target.value })}
                              placeholder="Note opzionali" />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSave(plan, ex)} disabled={saving}>
                              <Check className="w-3.5 h-3.5" /> Salva
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setActiveForm(null)}>
                              Annulla
                            </Button>
                          </div>
                        </div>
                      )}

                      {exLogs.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase">Registrazioni</p>
                          {exLogs.slice(0, 5).map((log) => (
                            <div key={log.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-background">
                              <span className="text-muted-foreground">{moment(log.data).format("D MMM")}</span>
                              <span>
                                {log.peso_usato ? `${log.peso_usato}kg · ` : ""}
                                {log.reps_fatte ? `${log.reps_fatte} reps` : ""}
                                {log.rpe_percepito ? ` · RPE ${log.rpe_percepito}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}