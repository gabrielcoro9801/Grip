import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logAction } from "@/lib/auditLog";
import { ROLES } from "@/lib/permissions";
import GestioneRuoli from "@/components/admin/GestioneRuoli";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Pencil, KeyRound, UserPlus, Ban, CheckCircle2 } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

const TIPO_LABEL = { dipendente: "Dipendente", collaboratore_sportivo: "Coll. sportivo" };

export default function Admin() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const { organization } = useOrganization();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [form, setForm] = useState({ nome: "", email: "", ruolo: "reception", password: "", linked_collaboratore_id: "", linked_member_id: "" });
  const [collaboratori, setCollaboratori] = useState([]);
  const [members, setMembers] = useState([]);

  const loadData = useCallback(() => {
    const collabCall = organization?.id
      ? api.entities.Collaboratore.filter({ organization_id: organization.id })
      : api.entities.Collaboratore.list();
    Promise.all([
      api.entities.StaffAccount.list(),
      collabCall,
      api.entities.Member.list(),
    ]).then(([a, colls, mems]) => { setAccounts(a); setCollaboratori(colls); setMembers(mems); setLoading(false); });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ nome: "", email: "", ruolo: "reception", password: "", linked_collaboratore_id: "", linked_member_id: "" });
    setShowForm(true);
  };

  const openEdit = (acc) => {
    setEditing(acc);
    // La password non è più leggibile (sul server esiste solo il suo hash): il campo
    // parte vuoto e viene inviato soltanto se l'utente ne digita una nuova.
    setForm({ nome: acc.nome, email: acc.email, ruolo: acc.ruolo, password: "", linked_collaboratore_id: acc.linked_collaboratore_id || "", linked_member_id: acc.linked_member_id || "" });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (editing) {
      const roleChanged = form.ruolo !== editing.ruolo;
      await api.entities.StaffAccount.update(editing.id, {
        nome: form.nome,
        email: form.email,
        ruolo: form.ruolo,
        // Campo vuoto = password invariata.
        ...(form.password ? { password: form.password } : {}),
        linked_collaboratore_id: form.linked_collaboratore_id || null,
        linked_member_id: form.linked_member_id || null,
      });
      if (roleChanged) {
        await logAction(staffUser, "role_change", "staff_account", form.nome, editing.id,
          `Ruolo cambiato da ${ROLES[editing.ruolo]?.label} a ${ROLES[form.ruolo]?.label}`);
      } else {
        await logAction(staffUser, "update", "staff_account", form.nome, editing.id, "Modifica dati account");
      }
      toast({ title: "Account aggiornato", description: form.nome });
    } else {
      const created = await api.entities.StaffAccount.create({
        nome: form.nome,
        email: form.email,
        ruolo: form.ruolo,
        password: form.password,
        attivo: true,
        linked_collaboratore_id: form.linked_collaboratore_id || null,
        linked_member_id: form.linked_member_id || null,
      });
      await logAction(staffUser, "create", "staff_account", form.nome, created.id, `Nuovo account ruolo ${ROLES[form.ruolo]?.label}`);
      toast({ title: "Account creato", description: form.nome });
    }
    setShowForm(false);
    loadData();
  };

  const toggleActive = async (acc) => {
    const newAttivo = !acc.attivo;
    await api.entities.StaffAccount.update(acc.id, { attivo: newAttivo });
    await logAction(
      staffUser,
      newAttivo ? "activate" : "deactivate",
      "staff_account",
      acc.nome,
      acc.id,
      newAttivo ? "Account riattivato" : "Account disattivato"
    );
    toast({
      title: newAttivo ? "Account riattivato" : "Account disattivato",
      description: acc.nome,
    });
    loadData();
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setGeneratedPassword("");
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let pwd = "";
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    await api.entities.StaffAccount.update(resetTarget.id, { password: pwd });
    await logAction(staffUser, "password_reset", "staff_account", resetTarget.nome, resetTarget.id, "Password resettata");
    setGeneratedPassword(pwd);
    toast({ title: "Password resettata", description: "Mostra la nuova password all'utente" });
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const collabAttivi = collaboratori.filter((c) => c.attivo !== false);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Gestione utenti" description="Account del personale, ruoli e permessi">
        <Button size="sm" onClick={openCreate}><UserPlus className="w-4 h-4 mr-1" /> Nuovo account</Button>
      </PageHeader>

      {/* Tabella utenti */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Email</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Ruolo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Ultima attività</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acc => (
              <tr key={acc.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 font-medium">{acc.nome}</td>
                <td className="py-3 px-4 text-muted-foreground">{acc.email}</td>
                <td className="py-3 px-4">
                  <Badge variant="outline">
                    {ROLES[acc.ruolo]?.label || acc.ruolo}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  {acc.attivo ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Attivo</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 border-red-200">Disattivato</Badge>
                  )}
                </td>
                <td className="py-3 px-4 text-muted-foreground text-xs">
                  {acc.last_activity_date ? moment(acc.last_activity_date).format("DD/MM/YYYY HH:mm") : "—"}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(acc)} title="Modifica">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setResetTarget(acc); setGeneratedPassword(""); }} title="Reimposta password">
                      <KeyRound className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => toggleActive(acc)}
                      title={acc.attivo ? "Disattiva" : "Riattiva"}
                      disabled={acc.id === staffUser?.id}
                    >
                      {acc.attivo ? <Ban className="w-3.5 h-3.5 text-destructive" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Matrice permessi */}
      <GestioneRuoli />

      {/* Dialog: Crea/Modifica account */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Modifica account" : "Nuovo account"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} /></div>
            <div><Label>Email *</Label><Input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
            <div>
              <Label>Ruolo *</Label>
              <Select value={form.ruolo} onValueChange={v => setForm({...form, ruolo: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLES).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{editing ? "Password" : "Password *"}</Label>
              <Input
                type="password"
                required={!editing}
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                placeholder={editing ? "Lascia vuoto per non cambiarla" : ""}
              />
            </div>
            <div>
              <Label>Collaboratore collegato (opzionale)</Label>
              <Select value={form.linked_collaboratore_id || "none"} onValueChange={v => setForm({...form, linked_collaboratore_id: v === "none" ? "" : v})}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nessuno —</SelectItem>
                  {collabAttivi.map(c => <SelectItem key={c.id} value={c.id}>{c.nome} {c.cognome} · {TIPO_LABEL[c.tipo_rapporto] || c.tipo_rapporto}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Necessario per i ruoli Dipendente e PT (accesso al portale)</p>
            </div>
            <div>
              <Label>Cliente collegato (opzionale)</Label>
              <Select value={form.linked_member_id || "none"} onValueChange={v => setForm({...form, linked_member_id: v === "none" ? "" : v})}>
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nessuno —</SelectItem>
                  {members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Necessario per il ruolo Cliente (accesso al portale cliente)</p>
            </div>
            <Button type="submit" className="w-full">{editing ? "Salva modifiche" : "Crea account"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reset password */}
      <Dialog open={!!resetTarget} onOpenChange={(v) => { if (!v) { setResetTarget(null); setGeneratedPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reset password — {resetTarget?.nome}</DialogTitle></DialogHeader>
          {generatedPassword ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Nuova password temporanea generata:</p>
              <div className="p-3 rounded-lg bg-muted font-mono text-lg text-center break-all">{generatedPassword}</div>
              <p className="text-xs text-amber-600">Comunica questa password all'utente. Potrà essere cambiata in seguito.</p>
              <Button className="w-full" onClick={() => { setResetTarget(null); setGeneratedPassword(""); }}>Chiudi</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Verrà generata una nuova password temporanea per <strong>{resetTarget?.nome}</strong>.</p>
              <Button className="w-full" onClick={handleResetPassword}>Genera nuova password</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}