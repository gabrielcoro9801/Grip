import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logAction } from "@/lib/auditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Clock, MapPin } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { puo } from "@/lib/permissions";

export default function TurniPage() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  // Chi gestisce il personale vede i dati di tutti; un dipendente vede i propri.
  const gestisceTutti = puo(staffUser?.ruolo, "gestire_personale");
  const empId = staffUser?.linked_collaboratore_id;
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [turni, setTurni] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    dipendente_id: "",
    data: new Date().toISOString().split("T")[0],
    ora_inizio: "09:00",
    ora_fine: "17:00",
    sala_id: "",
    note: "",
    ripeti: 1,
  });

  const loadData = async () => {
    if (gestisceTutti) {
      if (!organization?.id) return;
      const [tur, emps, rms] = await Promise.all([
        api.entities.Turno.list("-data", 200),
        api.entities.Collaboratore.filter({ organization_id: organization.id, tipo_rapporto: "dipendente" }),
        api.entities.Room.list(),
      ]);
      setTurni(tur); setEmployees(emps); setRooms(rms);
    } else if (empId) {
      const tur = await api.entities.Turno.filter({ dipendente_id: empId }, "data", 100);
      setTurni(tur);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [organization]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const emp = employees.find((em) => em.id === form.dipendente_id);
    const room = rooms.find((r) => r.id === form.sala_id);
    const ripeti = Math.max(1, Math.min(12, Number(form.ripeti) || 1));
    const baseDate = moment(form.data);
    const turniData = [];
    for (let i = 0; i < ripeti; i++) {
      const data = baseDate.clone().add(i * 7, "days").format("YYYY-MM-DD");
      turniData.push({
        dipendente_id: form.dipendente_id,
        dipendente_nome: emp ? `${emp.nome} ${emp.cognome}` : "",
        data,
        ora_inizio: form.ora_inizio,
        ora_fine: form.ora_fine,
        sala_id: form.sala_id || "",
        sala_nome: room?.name || "",
        note: form.note || "",
        stato: "assegnato",
      });
    }
    await api.entities.Turno.bulkCreate(turniData);
    await logAction(staffUser, "create", "turno", emp ? `${emp.nome} ${emp.cognome}` : "", "", `Turno ${form.data} ${form.ora_inizio}-${form.ora_fine}${ripeti > 1 ? ` (ripetuto ${ripeti}x)` : ""}`);
    toast({ title: "Turno creato", description: ripeti > 1 ? `${ripeti} turni creati` : "Turno assegnato" });
    setShowForm(false);
    setForm({ ...form, dipendente_id: "", note: "", ripeti: 1 });
    loadData();
  };

  const handleDelete = async (t) => {
    await api.entities.Turno.update(t.id, { stato: "annullato" });
    await logAction(staffUser, "delete", "turno", t.dipendente_nome, t.id, `Turno ${t.data} annullato`);
    toast({ title: "Turno annullato" });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  if (!gestisceTutti && !empId) {
    return <p className="text-sm text-muted-foreground">Profilo non collegato a un dipendente.</p>;
  }

  const todayStr = moment().format("YYYY-MM-DD");
  const turniAttivi = turni.filter((t) => t.stato !== "annullato");
  const prossimi = turniAttivi.filter((t) => t.data >= todayStr).sort((a, b) => a.data.localeCompare(b.data));
  const passati = turniAttivi.filter((t) => t.data < todayStr).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">Turni</h1>
        {gestisceTutti && <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo turno</Button>}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Prossimi</h2>
        {prossimi.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun turno programmato.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {prossimi.map((t) => (
              <Card key={t.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium capitalize">{moment(t.data).format("ddd DD MMM")}</p>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Clock className="w-3.5 h-3.5" /> {t.ora_inizio}–{t.ora_fine}
                      </div>
                      {t.sala_nome && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <MapPin className="w-3 h-3" /> {t.sala_nome}
                        </div>
                      )}
                      {gestisceTutti && <p className="text-xs text-muted-foreground mt-1">{t.dipendente_nome}</p>}
                    </div>
                    {gestisceTutti && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(t)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                  {t.note && <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">{t.note}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {passati.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Storico (ultimi 10)</h2>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Orario</th>
                  {gestisceTutti && <th className="py-3 px-4 font-medium text-muted-foreground">Dipendente</th>}
                  <th className="py-3 px-4 font-medium text-muted-foreground">Sala</th>
                </tr>
              </thead>
              <tbody>
                {passati.map((t) => (
                  <tr key={t.id} className="border-b border-border/50">
                    <td className="py-3 px-4 capitalize">{moment(t.data).format("ddd DD MMM")}</td>
                    <td className="py-3 px-4 text-muted-foreground">{t.ora_inizio}–{t.ora_fine}</td>
                    {gestisceTutti && <td className="py-3 px-4">{t.dipendente_nome}</td>}
                    <td className="py-3 px-4 text-muted-foreground">{t.sala_nome || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo turno</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Dipendente *</Label>
              <Select value={form.dipendente_id} onValueChange={(v) => setForm({ ...form, dipendente_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Seleziona dipendente" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.cognome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data *</Label><Input type="date" required value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inizio *</Label><Input type="time" required value={form.ora_inizio} onChange={(e) => setForm({ ...form, ora_inizio: e.target.value })} /></div>
              <div><Label>Fine *</Label><Input type="time" required value={form.ora_fine} onChange={(e) => setForm({ ...form, ora_fine: e.target.value })} /></div>
            </div>
            <div>
              <Label>Sala</Label>
              <Select value={form.sala_id || "none"} onValueChange={(v) => setForm({ ...form, sala_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Nessuna" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nessuna —</SelectItem>
                  {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ripeti per N settimane</Label>
              <Input type="number" min="1" max="12" value={form.ripeti} onChange={(e) => setForm({ ...form, ripeti: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">Crea lo stesso turno per N settimane consecutive (1 = singolo)</p>
            </div>
            <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.dipendente_id}>Crea turno</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}