import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { logAction } from "@/lib/auditLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Check, X, Hourglass } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { calcFerieResidue } from "@/lib/presenzeUtils";

const STATO_LABEL = { in_attesa: "In attesa", approvata: "Approvata", rifiutata: "Rifiutata" };
const STATO_VARIANT = { in_attesa: "secondary", approvata: "default", rifiutata: "destructive" };

export default function FeriePermessiPage() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const isAdmin = staffUser?.ruolo === "admin";
  const empId = staffUser?.linked_collaboratore_id;
  const [loading, setLoading] = useState(true);
  const [richieste, setRichieste] = useState([]);
  const [employee, setEmployee] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tipo: "ferie", data_inizio: "", data_fine: "", ore: "", motivazione: "" });

  const loadData = async () => {
    if (isAdmin) {
      const r = await base44.entities.RichiestaFeriePermesso.list("-created_date", 200);
      setRichieste(r);
    } else if (empId) {
      const [r, emp] = await Promise.all([
        base44.entities.RichiestaFeriePermesso.filter({ dipendente_id: empId }, "-created_date", 100),
        base44.entities.Collaboratore.get(empId).catch(() => null),
      ]);
      setRichieste(r);
      setEmployee(emp);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await base44.entities.RichiestaFeriePermesso.create({
      dipendente_id: empId,
      dipendente_nome: employee ? `${employee.nome} ${employee.cognome}` : staffUser.nome,
      tipo: form.tipo,
      data_inizio: form.data_inizio,
      data_fine: form.tipo === "ferie" ? (form.data_fine || form.data_inizio) : form.data_inizio,
      ore: form.tipo === "permesso" ? Number(form.ore) || 0 : 0,
      stato: "in_attesa",
      motivazione: form.motivazione || "",
    });
    toast({ title: "Richiesta inviata", description: "In attesa di approvazione" });
    setShowForm(false);
    setForm({ tipo: "ferie", data_inizio: "", data_fine: "", ore: "", motivazione: "" });
    loadData();
  };

  const handleApprove = async (r, approvato) => {
    await base44.entities.RichiestaFeriePermesso.update(r.id, {
      stato: approvato ? "approvata" : "rifiutata",
      approvato_da: staffUser.nome,
      approvato_il: new Date().toISOString(),
    });
    await logAction(
      staffUser, approvato ? "approve" : "reject", "ferie_permesso", r.dipendente_nome, r.id,
      `${r.tipo === "ferie" ? "Ferie" : "Permesso"} ${r.data_inizio}${r.data_fine && r.data_fine !== r.data_inizio ? `→${r.data_fine}` : ""} — ${approvato ? "approvata" : "rifiutata"}`
    );
    toast({ title: approvato ? "Richiesta approvata" : "Richiesta rifiutata" });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  if (!isAdmin && !empId) {
    return <p className="text-sm text-muted-foreground">Profilo non collegato a un dipendente.</p>;
  }

  const ferieResidue = employee ? calcFerieResidue(richieste, employee.giorni_ferie_anno, moment().year()) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">Ferie & Permessi</h1>
        {!isAdmin && <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuova richiesta</Button>}
      </div>

      {!isAdmin && employee && (
        <Card className="border-0 shadow-sm bg-emerald-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Hourglass className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">Ferie residue {moment().year()}</p>
              <p className="text-2xl font-bold text-emerald-700">{ferieResidue} giorni</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {richieste.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessuna richiesta.</p>
        ) : (
          richieste.map((r) => (
            <Card key={r.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={r.tipo === "ferie" ? "default" : "secondary"}>{r.tipo === "ferie" ? "Ferie" : "Permesso"}</Badge>
                      <Badge variant={STATO_VARIANT[r.stato]}>{STATO_LABEL[r.stato]}</Badge>
                      {r.ore > 0 && <span className="text-xs text-muted-foreground">{r.ore}h</span>}
                    </div>
                    <p className="text-sm font-medium">
                      {moment(r.data_inizio).format("DD/MM/YYYY")}
                      {r.data_fine && r.data_fine !== r.data_inizio && ` → ${moment(r.data_fine).format("DD/MM/YYYY")}`}
                    </p>
                    {isAdmin && <p className="text-xs text-muted-foreground mt-0.5">{r.dipendente_nome}</p>}
                    {r.motivazione && <p className="text-xs text-muted-foreground mt-1 italic">"{r.motivazione}"</p>}
                    {r.approvato_da && <p className="text-xs text-muted-foreground mt-1">Gestita da {r.approvato_da}</p>}
                  </div>
                  {isAdmin && r.stato === "in_attesa" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleApprove(r, true)}><Check className="w-4 h-4 mr-1" /> Approva</Button>
                      <Button size="sm" variant="outline" onClick={() => handleApprove(r, false)}><X className="w-4 h-4 mr-1" /> Rifiuta</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuova richiesta</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ferie">Ferie</SelectItem>
                  <SelectItem value="permesso">Permesso (orario)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{form.tipo === "permesso" ? "Data *" : "Data inizio *"}</Label>
                <Input type="date" required value={form.data_inizio} onChange={(e) => setForm({ ...form, data_inizio: e.target.value })} />
              </div>
              {form.tipo === "ferie" && (
                <div>
                  <Label>Data fine</Label>
                  <Input type="date" value={form.data_fine} onChange={(e) => setForm({ ...form, data_fine: e.target.value })} />
                </div>
              )}
              {form.tipo === "permesso" && (
                <div>
                  <Label>Ore *</Label>
                  <Input type="number" step="0.5" min="1" max="8" required value={form.ore} onChange={(e) => setForm({ ...form, ore: e.target.value })} />
                </div>
              )}
            </div>
            <div><Label>Motivazione</Label><Textarea rows={2} value={form.motivazione} onChange={(e) => setForm({ ...form, motivazione: e.target.value })} /></div>
            <Button type="submit" className="w-full">Invia richiesta</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}