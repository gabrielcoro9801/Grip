import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { useOrganization } from "@/hooks/useOrganization";
import { Plus, Search, Mail, Phone, Eye } from "lucide-react";

export default function MembersList() {
  const { organization } = useOrganization();
  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", date_of_birth: "", address: "", emergency_contact_name: "", emergency_contact_phone: "", gdpr_consent: false });

  const loadData = () => {
    Promise.all([
      api.entities.Member.list(),
      api.entities.Subscription.list(),
    ]).then(([m, s]) => {
      setMembers(m);
      setSubscriptions(s);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);

  const getMemberSub = (memberId) => {
    return subscriptions.find(s => s.member_id === memberId) || null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = { ...form };
    if (data.gdpr_consent) data.gdpr_consent_date = new Date().toISOString().split("T")[0];
    // Crea automaticamente il Client collegato in background
    const [nome, ...cognomeParts] = (data.full_name || "").trim().split(" ");
    const cognome = cognomeParts.join(" ");
    const client = await api.entities.Client.create({
      organization_id: organization?.id || undefined,
      tipo: "privato",
      nome: nome || data.full_name,
      cognome,
      email: data.email || "",
      telefono: data.phone || "",
      attivo: true,
    });
    // Il codice socio lo assegna il server: calcolarlo qui sul massimo fra i soci caricati
    // in pagina assegnerebbe lo stesso codice a due iscrizioni contemporanee.
    await api.entities.Member.create({ ...data, cliente_id: client.id });
    setShowForm(false);
    setForm({ full_name: "", email: "", phone: "", date_of_birth: "", address: "", emergency_contact_name: "", emergency_contact_phone: "", gdpr_consent: false });
    loadData();
  };

  const filtered = members.filter(m =>
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (m.email && m.email.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Soci" description={`${members.length} soci registrati`}>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Aggiungi socio
        </Button>
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca soci..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(member => {
          const sub = getMemberSub(member.id);
          return (
            <Link key={member.id} to={`/crm/members/${member.id}`}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">{member.full_name.split(" ").map(n => n[0]).join("")}</span>
                    </div>
                    {sub && <StatusBadge status={sub.status} />}
                  </div>
                  <h3 className="font-medium text-sm">{member.full_name}</h3>
                  {member.codice_socio && <p className="text-xs text-muted-foreground mt-0.5 font-mono">Codice: {member.codice_socio}</p>}
                  {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub.plan_name}</p>}
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    {member.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{member.email}</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aggiungi nuovo socio</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><Label>Nome completo *</Label><Input required value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Telefono</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data di nascita</Label><Input type="date" value={form.date_of_birth} onChange={e => setForm({...form, date_of_birth: e.target.value})} /></div>
              <div><Label>Indirizzo</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contatto di emergenza</Label><Input value={form.emergency_contact_name} onChange={e => setForm({...form, emergency_contact_name: e.target.value})} /></div>
              <div><Label>Telefono emergenza</Label><Input value={form.emergency_contact_phone} onChange={e => setForm({...form, emergency_contact_phone: e.target.value})} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.gdpr_consent} onCheckedChange={v => setForm({...form, gdpr_consent: v})} />
              <Label className="text-sm">Consenso GDPR dato</Label>
            </div>
            <Button type="submit" className="w-full">Crea socio</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}