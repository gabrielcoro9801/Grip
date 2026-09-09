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
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Ban, CheckCircle2, Mail, Phone, UserCog, Activity } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { LoadingState } from "@/components/shared/Spinner";
import { formatEuro } from "@/lib/format";

const CONTRATTI = {
  fisso: { label: "Fisso (importo periodico)" },
  percentuale: { label: "Percentuale (% sull'incasso)" },
  a_seduta: { label: "A seduta (importo per seduta)" },
};

const emptyForm = {
  nome: "", cognome: "", tipo_rapporto: "dipendente", ruolo: "",
  email: "", phone: "", hire_date: "", notes: "", attivo: true,
  soglia_settimanale_ore: 40, giorni_ferie_anno: 26,
  tipo_contratto: "a_seduta", importo_fisso: "", percentuale: "", importo_seduta: "",
  importo_autocertificato_altri_enti: "", data_autocertificazione: "",
};

export default function TeamAnagrafica() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [collaboratori, setCollaboratori] = useState([]);
  const [filterTipo, setFilterTipo] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    if (!organization?.id) return;
    const colls = await api.entities.Collaboratore.filter({ organization_id: organization.id });
    setCollaboratori(colls);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [organization]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      nome: c.nome || "", cognome: c.cognome || "", tipo_rapporto: c.tipo_rapporto || "dipendente",
      ruolo: c.ruolo || "", email: c.email || "", phone: c.phone || "",
      hire_date: c.hire_date || "", notes: c.notes || "", attivo: c.attivo !== false,
      soglia_settimanale_ore: c.soglia_settimanale_ore ?? 40, giorni_ferie_anno: c.giorni_ferie_anno ?? 26,
      tipo_contratto: c.tipo_contratto || "a_seduta",
      importo_fisso: c.importo_fisso ?? "", percentuale: c.percentuale ?? "", importo_seduta: c.importo_seduta ?? "",
      importo_autocertificato_altri_enti: c.importo_autocertificato_altri_enti ?? "",
      data_autocertificazione: c.data_autocertificazione || "",
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const data = {
      organization_id: organization.id,
      nome: form.nome, cognome: form.cognome, tipo_rapporto: form.tipo_rapporto,
      ruolo: form.ruolo, email: form.email, phone: form.phone,
      hire_date: form.hire_date || null, notes: form.notes, attivo: form.attivo,
      soglia_settimanale_ore: Number(form.soglia_settimanale_ore) || 40,
      giorni_ferie_anno: Number(form.giorni_ferie_anno) || 26,
      tipo_contratto: form.tipo_contratto,
      importo_fisso: form.importo_fisso ? Number(form.importo_fisso) : null,
      percentuale: form.percentuale ? Number(form.percentuale) : null,
      importo_seduta: form.importo_seduta ? Number(form.importo_seduta) : null,
      importo_autocertificato_altri_enti: form.importo_autocertificato_altri_enti ? Number(form.importo_autocertificato_altri_enti) : null,
      data_autocertificazione: form.data_autocertificazione || null,
    };
    const nomeCompleto = `${form.nome} ${form.cognome}`;
    if (editing) {
      await api.entities.Collaboratore.update(editing.id, data);
      await logAction(staffUser, "update", "collaboratore", nomeCompleto, editing.id, "Modifica anagrafica collaboratore");
      toast({ title: "Collaboratore aggiornato" });
    } else {
      const created = await api.entities.Collaboratore.create(data);
      await logAction(staffUser, "create", "collaboratore", nomeCompleto, created.id, "Nuovo collaboratore");
      toast({ title: "Collaboratore creato" });
    }
    setShowForm(false);
    loadData();
  };

  const toggleAttivo = async (c) => {
    const attivoCorrente = c.attivo !== false;
    const nuovo = !attivoCorrente;
    await api.entities.Collaboratore.update(c.id, { attivo: nuovo });
    await logAction(staffUser, nuovo ? "activate" : "deactivate", "collaboratore", `${c.nome} ${c.cognome}`, c.id, nuovo ? "Collaboratore riattivato" : "Collaboratore disattivato");
    toast({ title: nuovo ? "Collaboratore riattivato" : "Collaboratore disattivato" });
    loadData();
  };

  if (loading) return <LoadingState minHeight="h-64" />;

  const filtered = filterTipo === "all" ? collaboratori : collaboratori.filter((c) => c.tipo_rapporto === filterTipo);
  const isSportivo = form.tipo_rapporto === "collaboratore_sportivo";
  const isDipendente = form.tipo_rapporto === "dipendente";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">Anagrafica Team</h1>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Nuovo collaboratore</Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="dipendente">Dipendenti</SelectItem>
            <SelectItem value="collaboratore_sportivo">Collaboratori sportivi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <Card key={c.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${c.tipo_rapporto === "dipendente" ? "bg-blue-100" : "bg-violet-100"}`}>
                    {c.tipo_rapporto === "dipendente"
                      ? <UserCog className="w-5 h-5 text-blue-700" />
                      : <Activity className="w-5 h-5 text-violet-700" />}
                  </div>
                  <div>
                    <h3 className="font-medium text-sm">{c.nome} {c.cognome}</h3>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="outline" className="text-xs">
                        {c.tipo_rapporto === "dipendente" ? "Dipendente" : "Coll. sportivo"}
                      </Badge>
                      <Badge variant={c.attivo !== false ? "default" : "secondary"} className="text-xs">
                        {c.attivo !== false ? "Attivo" : "Disattivato"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
              {c.ruolo && <p className="text-xs text-muted-foreground">{c.ruolo}</p>}
              <div className="space-y-1 mt-2 text-xs text-muted-foreground">
                {c.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</div>}
                {c.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</div>}
              </div>
              {c.tipo_rapporto === "collaboratore_sportivo" && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <Badge variant="outline" className="text-xs">{CONTRATTI[c.tipo_contratto]?.label || c.tipo_contratto}</Badge>
                  {c.tipo_contratto === "fisso" && c.importo_fisso != null && <p className="text-xs mt-1">{formatEuro(Number(c.importo_fisso))}/periodo</p>}
                  {c.tipo_contratto === "percentuale" && c.percentuale != null && <p className="text-xs mt-1">{c.percentuale}% sull'incasso</p>}
                  {c.tipo_contratto === "a_seduta" && c.importo_seduta != null && <p className="text-xs mt-1">{formatEuro(Number(c.importo_seduta))}/seduta</p>}
                  {c.importo_autocertificato_altri_enti != null && <p className="text-xs mt-1 text-amber-600">Altri enti: {formatEuro(Number(c.importo_autocertificato_altri_enti))}</p>}
                </div>
              )}
              <div className="flex gap-1 mt-3">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleAttivo(c)}>
                  {c.attivo !== false ? <Ban className="w-3.5 h-3.5 text-destructive" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun collaboratore registrato.</p>}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Modifica collaboratore" : "Nuovo collaboratore"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nome *</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>Cognome *</Label><Input required value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo rapporto *</Label>
                <Select value={form.tipo_rapporto} onValueChange={(v) => setForm({ ...form, tipo_rapporto: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dipendente">Dipendente</SelectItem>
                    <SelectItem value="collaboratore_sportivo">Collaboratore sportivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Ruolo</Label><Input placeholder="es. Istruttore, Reception, PT" value={form.ruolo} onChange={(e) => setForm({ ...form, ruolo: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>Data assunzione</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></div>

            {isDipendente && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-blue-50/50 border border-blue-100">
                <div><Label>Soglia settimanale (ore)</Label><Input type="number" value={form.soglia_settimanale_ore} onChange={(e) => setForm({ ...form, soglia_settimanale_ore: e.target.value })} /></div>
                <div><Label>Ferie/anno (giorni)</Label><Input type="number" value={form.giorni_ferie_anno} onChange={(e) => setForm({ ...form, giorni_ferie_anno: e.target.value })} /></div>
              </div>
            )}

            {isSportivo && (
              <div className="space-y-3 p-3 rounded-lg bg-violet-50/50 border border-violet-100">
                <div>
                  <Label>Tipo contratto *</Label>
                  <Select value={form.tipo_contratto} onValueChange={(v) => setForm({ ...form, tipo_contratto: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONTRATTI).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {form.tipo_contratto === "fisso" && <div><Label>Importo fisso (€/periodo)</Label><Input type="number" step="0.01" value={form.importo_fisso} onChange={(e) => setForm({ ...form, importo_fisso: e.target.value })} /></div>}
                {form.tipo_contratto === "percentuale" && <div><Label>Percentuale (%)</Label><Input type="number" step="0.1" value={form.percentuale} onChange={(e) => setForm({ ...form, percentuale: e.target.value })} /></div>}
                {form.tipo_contratto === "a_seduta" && <div><Label>Importo a seduta (€)</Label><Input type="number" step="0.01" value={form.importo_seduta} onChange={(e) => setForm({ ...form, importo_seduta: e.target.value })} /></div>}
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Autocert. altri enti (€)</Label><Input type="number" step="0.01" value={form.importo_autocertificato_altri_enti} onChange={(e) => setForm({ ...form, importo_autocertificato_altri_enti: e.target.value })} /></div>
                  <div><Label>Data autocertificazione</Label><Input type="date" value={form.data_autocertificazione} onChange={(e) => setForm({ ...form, data_autocertificazione: e.target.value })} /></div>
                </div>
                <p className="text-xs text-muted-foreground">Usato per il monitoraggio della soglia di esenzione €15.000/anno.</p>
              </div>
            )}

            <div><Label>Note</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full">{editing ? "Salva modifiche" : "Crea collaboratore"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}