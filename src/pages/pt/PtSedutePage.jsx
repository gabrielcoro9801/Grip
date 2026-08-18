import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logAction } from "@/lib/auditLog";
import { validateSedutaForm } from "@/lib/ptValidation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, X, Clock, MapPin, User } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

const STATO_LABEL = { prenotata: "Prenotata", confermata: "Confermata", svolta: "Svolta", annullata: "Annullata" };
const STATO_VARIANT = { prenotata: "secondary", confermata: "default", svolta: "default", annullata: "destructive" };

export default function PtSedutePage() {
  const { staffUser } = useStaffAuth();
  const { organization } = useOrganization();
  const { toast } = useToast();
  const isPT = staffUser?.ruolo === "pt";
  const collaboratoreId = staffUser?.linked_collaboratore_id;
  const [loading, setLoading] = useState(true);
  const [sedute, setSedute] = useState([]);
  const [collaboratori, setCollaboratori] = useState([]);
  const [clients, setClients] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    collaboratore_id: "", cliente_id: "", sala_id: "",
    data_ora_inizio: "", data_ora_fine: "", importo: "", note: "",
  });

  const loadData = async () => {
    const [allSedute, colls, cls, rms] = await Promise.all([
      base44.entities.SedutaPT.list("-data_ora_inizio", 200),
      base44.entities.Collaboratore.filter({ organization_id: organization?.id, tipo_rapporto: "collaboratore_sportivo" }),
      base44.entities.Client.list(),
      base44.entities.Room.list(),
    ]);
    setSedute(isPT ? allSedute.filter((s) => s.collaboratore_id === collaboratoreId) : allSedute);
    setCollaboratori(colls);
    setClients(cls);
    setRooms(rms);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [organization, collaboratoreId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const coll = collaboratori.find((c) => c.id === form.collaboratore_id);
    const client = clients.find((c) => c.id === form.cliente_id);
    const room = rooms.find((r) => r.id === form.sala_id);

    const formData = {
      ...form,
      data_ora_inizio: form.data_ora_inizio ? moment(form.data_ora_inizio).toISOString() : "",
      data_ora_fine: form.data_ora_fine ? moment(form.data_ora_fine).toISOString() : "",
      importo: Number(form.importo) || 0,
    };

    const error = validateSedutaForm(formData, sedute);
    if (error) {
      toast({ title: "Errore", description: error, variant: "destructive" });
      return;
    }

    const created = await base44.entities.SedutaPT.create({
      ...formData,
      collaboratore_nome: coll ? `${coll.nome} ${coll.cognome}` : "",
      cliente_nome: client ? (client.tipo === "azienda" ? client.ragione_sociale : [client.nome, client.cognome].filter(Boolean).join(" ")) : "",
      sala_nome: room?.name || "",
      stato: "prenotata",
    });
    await logAction(staffUser, "create", "pt_seduta", created.cliente_nome, created.id, `Seduta ${created.collaboratore_nome} ${form.data_ora_inizio}`);
    toast({ title: "Seduta prenotata" });
    setShowForm(false);
    setForm({ collaboratore_id: "", cliente_id: "", sala_id: "", data_ora_inizio: "", data_ora_fine: "", importo: "", note: "" });
    loadData();
  };

  const handleStato = async (s, nuovoStato) => {
    const oldStato = s.stato;
    await base44.entities.SedutaPT.update(s.id, { stato: nuovoStato });
    await logAction(staffUser, "update", "pt_seduta", s.cliente_nome, s.id, `Stato: ${oldStato} → ${nuovoStato}`, oldStato, nuovoStato);
    toast({ title: `Seduta ${STATO_LABEL[nuovoStato].toLowerCase()}` });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  if (isPT && !collaboratoreId) {
    return <p className="text-sm text-muted-foreground">Profilo non collegato a un collaboratore.</p>;
  }

  const now = new Date();
  const prossime = sedute.filter((s) => s.stato !== "annullata" && s.stato !== "svolta" && new Date(s.data_ora_inizio) >= now);
  const passate = sedute.filter((s) => s.stato === "svolta" || s.stato === "annullata" || new Date(s.data_ora_inizio) < now).slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-bold">Sedute</h1>
        {!isPT && <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuova seduta</Button>}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Prossime</h2>
        {prossime.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna seduta programmata.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {prossime.map((s) => {
              const canConfirm = isPT && s.stato !== "svolta" && new Date(s.data_ora_inizio) <= now;
              return (
                <Card key={s.id} className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{s.cliente_nome}</p>
                        {!isPT && <p className="text-xs text-muted-foreground">{s.collaboratore_nome}</p>}
                      </div>
                      <Badge variant={STATO_VARIANT[s.stato]}>{STATO_LABEL[s.stato]}</Badge>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {moment(s.data_ora_inizio).format("ddd DD MMM HH:mm")}</div>
                      {s.sala_nome && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {s.sala_nome}</div>}
                      {s.importo > 0 && <div className="flex items-center gap-1"><User className="w-3 h-3" /> €{s.importo.toFixed(2)}</div>}
                    </div>
                    <div className="flex gap-2 mt-3">
                      {canConfirm && (
                        <Button size="sm" className="flex-1" onClick={() => handleStato(s, "svolta")}><Check className="w-4 h-4 mr-1" /> Conferma svolta</Button>
                      )}
                      {!isPT && s.stato !== "annullata" && s.stato !== "svolta" && (
                        <Button size="sm" variant="outline" onClick={() => handleStato(s, "annullata")}><X className="w-4 h-4 mr-1" /> Annulla</Button>
                      )}
                      {!isPT && s.stato === "svolta" && (
                        <Button size="sm" variant="outline" onClick={() => handleStato(s, "confermata")}>Ripristina</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {passate.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Storico</h2>
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Cliente</th>
                  {!isPT && <th className="py-3 px-4 font-medium text-muted-foreground">Collaboratore</th>}
                  <th className="py-3 px-4 font-medium text-muted-foreground">Sala</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
                </tr>
              </thead>
              <tbody>
                {passate.map((s) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="py-3 px-4">{moment(s.data_ora_inizio).format("DD/MM HH:mm")}</td>
                    <td className="py-3 px-4 font-medium">{s.cliente_nome}</td>
                    {!isPT && <td className="py-3 px-4 text-muted-foreground">{s.collaboratore_nome}</td>}
                    <td className="py-3 px-4 text-muted-foreground">{s.sala_nome || "—"}</td>
                    <td className="py-3 px-4"><Badge variant={STATO_VARIANT[s.stato]}>{STATO_LABEL[s.stato]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuova seduta</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Collaboratore *</Label>
              <Select value={form.collaboratore_id} onValueChange={(v) => setForm({ ...form, collaboratore_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Seleziona collaboratore" /></SelectTrigger>
                <SelectContent>
                  {collaboratori.filter((c) => c.attivo !== false).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} {c.cognome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cliente *</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm({ ...form, cliente_id: v })} required>
                <SelectTrigger><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => {
                    const name = c.tipo === "azienda" ? c.ragione_sociale : [c.nome, c.cognome].filter(Boolean).join(" ");
                    return <SelectItem key={c.id} value={c.id}>{name}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
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
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inizio *</Label><Input type="datetime-local" required value={form.data_ora_inizio} onChange={(e) => setForm({ ...form, data_ora_inizio: e.target.value })} /></div>
              <div><Label>Fine *</Label><Input type="datetime-local" required value={form.data_ora_fine} onChange={(e) => setForm({ ...form, data_ora_fine: e.target.value })} /></div>
            </div>
            <div><Label>Importo seduta (€)</Label><Input type="number" step="0.01" value={form.importo} onChange={(e) => setForm({ ...form, importo: e.target.value })} /></div>
            <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.collaboratore_id || !form.cliente_id}>Prenota seduta</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}