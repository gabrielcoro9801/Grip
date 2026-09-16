import React, { useState, useEffect } from "react";
import { api } from "@/core/api/client";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { useOrganization } from "@/staff/lib/useOrganization";
import { Plus, Search, Mail, Users } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import CampiAnagrafica, { ANAGRAFICA_VUOTA, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";

export default function MembersList() {
  const { organization } = useOrganization();
  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(ANAGRAFICA_VUOTA);
  const [salvando, setSalvando] = useState(false);
  const { toast } = useToast();

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
    setSalvando(true);
    try {
      // Il codice socio lo assegna il server: calcolarlo qui sul massimo fra i soci caricati
      // in pagina assegnerebbe lo stesso codice a due iscrizioni contemporanee.
      await api.entities.Member.create({ ...data, organization_id: organization?.id || undefined });
      setShowForm(false);
      setForm(ANAGRAFICA_VUOTA);
      loadData();
    } catch (err) {
      // Il server rifiuta, con un messaggio da leggere, un codice fiscale già presente.
      toast({ title: "Socio non creato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const cerca = search.toLowerCase();
  const filtered = members.filter(m =>
    m.full_name.toLowerCase().includes(cerca) ||
    (m.email && m.email.toLowerCase().includes(cerca)) ||
    (m.codice_fiscale && m.codice_fiscale.toLowerCase().includes(cerca))
  );
  const incompleto = motivoAnagraficaIncompleta(form);

  if (loading) {
    return <LoadingState minHeight="h-64" />;
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
        <Input placeholder="Nome, email o codice fiscale..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        // Senza, restava un'area bianca sotto la ricerca: indistinguibile da un
        // caricamento che non finisce, e senza dire che fare.
        <EmptyState
          icon={Users}
          title={members.length === 0 ? "Nessun socio registrato" : "Nessun socio corrisponde"}
          description={
            members.length === 0
              ? "Da qui si tesserano le persone che frequentano la palestra."
              : `Nessun risultato per «${search}». Prova con un altro nome o una parte di email.`
          }
        />
      ) : (
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
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Aggiungi nuovo socio</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <CampiAnagrafica valori={form} onChange={setForm} />
            {incompleto && <p className="text-xs text-muted-foreground">{incompleto}</p>}
            <Button type="submit" className="w-full" disabled={Boolean(incompleto) || salvando}>
              {salvando ? "Salvataggio..." : "Crea socio"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}