import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Search, Mail, Phone, Building, User, Link2 } from "lucide-react";

export default function ClientsList() {
  const { organization } = useOrganization();
  const [clients, setClients] = useState([]);
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ tipo: "privato", nome: "", cognome: "", ragione_sociale: "", email: "", telefono: "", codice_fiscale_piva: "", note: "" });

  const loadData = () => {
    if (!organization) return;
    Promise.all([
      api.entities.Client.filter({ organization_id: organization.id }),
      api.entities.Member.list(),
    ]).then(([c, m]) => { setClients(c); setMembers(m); setLoading(false); });
  };

  useEffect(() => { loadData(); }, [organization]);

  const displayName = (c) => c.tipo === "azienda" ? (c.ragione_sociale || "—") : [c.nome, c.cognome].filter(Boolean).join(" ") || "—";
  const linkedMember = (clientId) => members.find(m => m.cliente_id === clientId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await api.entities.Client.create({
      ...form,
      organization_id: organization.id,
      attivo: true,
    });
    setShowForm(false);
    setForm({ tipo: "privato", nome: "", cognome: "", ragione_sociale: "", email: "", telefono: "", codice_fiscale_piva: "", note: "" });
    loadData();
  };

  const filtered = clients.filter(c => {
    const name = displayName(c).toLowerCase();
    return name.includes(search.toLowerCase()) || (c.email && c.email.toLowerCase().includes(search.toLowerCase()));
  });

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Clienti" description={`${clients.length} clienti registrati`}>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Nuovo cliente
        </Button>
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca clienti..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(c => {
          const linked = linkedMember(c.id);
          const name = displayName(c);
          return (
            <Card key={c.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {c.tipo === "azienda"
                      ? <Building className="w-5 h-5 text-primary" />
                      : <User className="w-5 h-5 text-primary" />
                    }
                  </div>
                  <div className="flex gap-1">
                    {c.tipo === "azienda" && <Badge variant="outline" className="text-xs">Azienda</Badge>}
                    {linked && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs"><Link2 className="w-3 h-3 mr-1" />Associato</Badge>}
                  </div>
                </div>
                <h3 className="font-medium text-sm">{name}</h3>
                {c.codice_fiscale_piva && <p className="text-xs text-muted-foreground mt-0.5">CF/P.IVA: {c.codice_fiscale_piva}</p>}
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                  {c.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.telefono}</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">Nessun cliente trovato</p>}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo cliente occasionale</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label>Tipo cliente *</Label>
              <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privato">Privato</SelectItem>
                  <SelectItem value="azienda">Azienda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.tipo === "privato" ? (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
                <div><Label>Cognome *</Label><Input required value={form.cognome} onChange={e => setForm({ ...form, cognome: e.target.value })} /></div>
              </div>
            ) : (
              <div><Label>Ragione sociale *</Label><Input required value={form.ragione_sociale} onChange={e => setForm({ ...form, ragione_sociale: e.target.value })} /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} /></div>
            </div>
            <div><Label>Codice Fiscale / P.IVA</Label><Input value={form.codice_fiscale_piva} onChange={e => setForm({ ...form, codice_fiscale_piva: e.target.value })} /></div>
            <div><Label>Note</Label><Textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            <Button type="submit" className="w-full">Crea cliente</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}