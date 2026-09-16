import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/core/api/client";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { Plus, Search, Users } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { caricaFile } from "@/staff/lib/uploads";
import { formatData } from "@/core/domain/format";
import CampiAnagrafica, { ANAGRAFICA_VUOTA, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import { AvatarSocio, SceltaFoto } from "@/staff/components/soci/FotoSocio";

const FOTO_VUOTA = { file: null, rimossa: false };

// Più di un abbonamento per socio è normale (rinnovi, pacchetti): la tile ne mostra uno, e
// deve essere quello che conta oggi — prima l'attivo, poi quello in scadenza, poi il più recente.
const PRIORITA_STATO = { active: 0, expiring: 1, expired: 2 };
function abbonamentoRilevante(abbonamenti) {
  return [...abbonamenti].sort((a, b) =>
    (PRIORITA_STATO[a.status] ?? 3) - (PRIORITA_STATO[b.status] ?? 3)
    || String(b.end_date ?? "").localeCompare(String(a.end_date ?? ""))
  )[0] ?? null;
}

const confrontaTesto = (a, b) => (a ?? "").localeCompare(b ?? "", "it", { sensitivity: "base" });

// Ogni criterio ha un secondo ordinamento per cognome e nome: a parità, l'elenco non deve
// cambiare ordine da un caricamento all'altro.
const ORDINAMENTI = [
  { valore: "cognome", etichetta: "Cognome (A–Z)", confronta: (a, b) => confrontaTesto(a.cognome, b.cognome) || confrontaTesto(a.nome, b.nome) },
  { valore: "nome", etichetta: "Nome (A–Z)", confronta: (a, b) => confrontaTesto(a.nome, b.nome) || confrontaTesto(a.cognome, b.cognome) },
  { valore: "codice", etichetta: "Codice socio", confronta: (a, b) => confrontaTesto(a.codice_socio, b.codice_socio) },
  { valore: "recenti", etichetta: "Iscritti più di recente", confronta: (a, b) => String(b.created_date).localeCompare(String(a.created_date)) },
  {
    valore: "scadenza",
    etichetta: "Scadenza abbonamento",
    // Chi scade prima in cima; chi non ha abbonamento in fondo, dove non disturba.
    confronta: (a, b) => {
      const sa = a._abbonamento?.end_date, sb = b._abbonamento?.end_date;
      if (!sa || !sb) return (sa ? 0 : 1) - (sb ? 0 : 1) || confrontaTesto(a.cognome, b.cognome);
      return String(sa).localeCompare(String(sb)) || confrontaTesto(a.cognome, b.cognome);
    },
  },
];

function RigaTile({ etichetta, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs min-h-5">
      <dt className="text-muted-foreground flex-shrink-0">{etichetta}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [search, setSearch] = useState("");
  const [ordine, setOrdine] = useState("cognome");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(ANAGRAFICA_VUOTA);
  const [foto, setFoto] = useState(FOTO_VUOTA);
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

  const chiudiForm = () => {
    setShowForm(false);
    setForm(ANAGRAFICA_VUOTA);
    setFoto(FOTO_VUOTA);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      // Prima la foto, poi il socio: così il socio nasce già con la sua foto, in una scrittura.
      const foto_url = foto.file ? (await caricaFile({ file: foto.file })).file_url : null;
      // Il codice socio lo assegna il server, sempre: calcolarlo qui sul massimo fra i soci
      // caricati in pagina assegnerebbe lo stesso codice a due iscrizioni contemporanee.
      await api.entities.Member.create({ ...form, foto_url });
      chiudiForm();
      loadData();
    } catch (err) {
      // Il server rifiuta, con un messaggio da leggere, un codice fiscale già presente.
      toast({ title: "Socio non creato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const elenco = useMemo(() => {
    const cerca = search.trim().toLowerCase();
    const perSocio = new Map();
    for (const s of subscriptions) {
      if (!perSocio.has(s.member_id)) perSocio.set(s.member_id, []);
      perSocio.get(s.member_id).push(s);
    }
    const criterio = ORDINAMENTI.find((o) => o.valore === ordine) ?? ORDINAMENTI[0];
    return members
      .map((m) => ({ ...m, _abbonamento: abbonamentoRilevante(perSocio.get(m.id) ?? []) }))
      .filter((m) => !cerca || [m.full_name, m.email, m.codice_fiscale, m.codice_socio, m.phone]
        .some((v) => v && v.toLowerCase().includes(cerca)))
      .sort(criterio.confronta);
  }, [members, subscriptions, search, ordine]);

  const incompleto = motivoAnagraficaIncompleta(form);

  if (loading) {
    return <LoadingState minHeight="h-64" />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader title="Gestione membri" description={`${members.length} soci registrati`}>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Aggiungi socio
        </Button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Nome, codice, telefono, email o CF..."
            aria-label="Cerca un socio"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Label htmlFor="ordina-soci" className="text-sm text-muted-foreground whitespace-nowrap">Ordina per</Label>
          <Select value={ordine} onValueChange={setOrdine}>
            <SelectTrigger id="ordina-soci" className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDINAMENTI.map((o) => <SelectItem key={o.valore} value={o.valore}>{o.etichetta}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {elenco.length === 0 ? (
        // Senza, restava un'area bianca sotto la ricerca: indistinguibile da un
        // caricamento che non finisce, e senza dire che fare.
        <EmptyState
          icon={Users}
          title={members.length === 0 ? "Nessun socio registrato" : "Nessun socio corrisponde"}
          description={
            members.length === 0
              ? "Da qui si tesserano le persone che frequentano la palestra."
              : `Nessun risultato per «${search}». Prova con un altro nome, il codice o il telefono.`
          }
        />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {elenco.map(member => {
          const sub = member._abbonamento;
          return (
            <Link key={member.id} to={`/crm/soci/${member.id}`} className="block">
              {/* Tutte le tile hanno la stessa altezza e le stesse righe, piene o con un
                  trattino: si confrontano a colpo d'occhio, e la griglia non balla. */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-[200px]">
                <CardContent className="p-4 h-full flex flex-col">
                  <div className="flex items-start gap-3">
                    <AvatarSocio socio={member} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm truncate" title={member.full_name}>{member.full_name}</h3>
                      <p className="text-xs text-muted-foreground font-mono">{member.codice_socio}</p>
                    </div>
                  </div>
                  <dl className="mt-auto space-y-1.5">
                    <RigaTile etichetta="Stato">
                      {sub
                        ? <StatusBadge status={sub.status} className="py-0" />
                        : <StatusBadge status="nessuno" label="Senza abbonamento" tone="neutro" className="py-0" />}
                    </RigaTile>
                    <RigaTile etichetta="Abbonamento">{sub?.plan_name || "—"}</RigaTile>
                    <RigaTile etichetta="Scadenza">{sub?.end_date ? formatData(sub.end_date, "media") : "—"}</RigaTile>
                    <RigaTile etichetta="Telefono">{member.phone || "—"}</RigaTile>
                    <RigaTile etichetta="Email">{member.email || "—"}</RigaTile>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      )}

      <Dialog open={showForm} onOpenChange={(aperta) => (aperta ? setShowForm(true) : chiudiForm())}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Aggiungi nuovo socio</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <CampiAnagrafica valori={form} onChange={setForm} />
            <SceltaFoto socio={form} file={foto.file} onChange={setFoto} />
            <Button type="submit" className="w-full" disabled={Boolean(incompleto) || salvando}>
              {salvando ? "Salvataggio..." : "Crea socio"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
