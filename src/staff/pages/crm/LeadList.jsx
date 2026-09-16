import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import CampiLead, { LEAD_VUOTO } from "@/staff/components/lead/CampiLead";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { logAction } from "@/staff/lib/auditLog";
import { formatData, formatPercentuale, toIsoDate } from "@/core/domain/format";
import {
  STATI_LEAD, statoChiuso, etichettaFonte, leadDaRicontattare, riepilogoProve,
} from "@/core/domain/lead";
import { Plus, Search, UserPlus, PhoneCall, Phone } from "lucide-react";

const TUTTI_I_CORSI = "tutti";

// "Aperti" è il filtro di partenza: chi apre l'elenco al banco cerca le persone su cui c'è
// ancora qualcosa da fare, non l'archivio di chi si è iscritto a marzo.
const FILTRI = [
  { valore: "aperti", etichetta: "Aperti", vale: (l) => !statoChiuso(l.stato) },
  ...STATI_LEAD.map((s) => ({ valore: s.valore, etichetta: s.etichetta, vale: (l) => l.stato === s.valore })),
  { valore: "tutti", etichetta: "Tutti", vale: () => true },
];

export default function LeadList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_leads");

  const [leads, setLeads] = useState([]);
  const [corsi, setCorsi] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState(null);

  const [filtro, setFiltro] = useState("aperti");
  const [corso, setCorso] = useState(TUTTI_I_CORSI);
  const [cerca, setCerca] = useState("");
  const [nuovo, setNuovo] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(() => {
    setErrore(null);
    Promise.all([
      api.entities.Lead.list("-created_date"),
      api.entities.Course.list(),
      api.entities.Booking.list(),
    ])
      .then(([l, c, b]) => {
        setLeads(l);
        setCorsi(c);
        setPrenotazioni(b.filter((p) => p.lead_id));
      })
      .catch(setErrore)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const oggi = toIsoDate(new Date());
  const nomeCorso = useMemo(() => new Map(corsi.map((c) => [c.id, c.name])), [corsi]);
  const daRicontattare = useMemo(() => leadDaRicontattare(leads, oggi), [leads, oggi]);
  const riepilogo = useMemo(() => riepilogoProve({ bookings: prenotazioni, leads }), [prenotazioni, leads]);

  const conteggi = useMemo(
    () => Object.fromEntries(FILTRI.map((f) => [f.valore, leads.filter(f.vale).length])),
    [leads]
  );

  const visibili = useMemo(() => {
    const regola = FILTRI.find((f) => f.valore === filtro)?.vale ?? (() => true);
    const testo = cerca.trim().toLowerCase();
    return leads.filter((l) =>
      regola(l)
      && (corso === TUTTI_I_CORSI || l.corso_interesse_id === corso)
      && (!testo
        || l.full_name.toLowerCase().includes(testo)
        || (l.phone ?? "").includes(testo)
        || (l.email ?? "").toLowerCase().includes(testo))
    );
  }, [leads, filtro, corso, cerca]);

  const crea = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const creato = await api.entities.Lead.create(nuovo);
      await logAction(staffUser, "create", "lead", creato.full_name, creato.id, "Nuovo lead");
      setNuovo(null);
      // Si va dritti alla scheda: la cosa che si fa subito dopo aver registrato qualcuno al
      // banco è prenotargli la prova, finché è ancora lì davanti.
      navigate(`/crm/lead/${creato.id}`);
    } catch (err) {
      toast({ title: "Non è stato possibile salvare", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  if (loading) return <LoadingState minHeight="h-64" />;
  if (errore) return <ErrorState error={errore} onRetry={carica} />;

  const aperti = conteggi.aperti;
  const descrizione = [
    `${aperti} ${aperti === 1 ? "contatto aperto" : "contatti aperti"}`,
    riepilogo.conversione !== null
      ? `${formatPercentuale(riepilogo.conversione * 100, { decimali: 0 })} di chi ha provato si è iscritto`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Lead" description={descrizione}>
        {puoModificare && (
          <Button size="sm" onClick={() => setNuovo({ ...LEAD_VUOTO })}>
            <Plus className="w-4 h-4 mr-1" /> Nuovo lead
          </Button>
        )}
      </PageHeader>

      {daRicontattare.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-warning" /> Da ricontattare oggi
              <span className="ml-auto text-xs font-normal text-muted-foreground">{daRicontattare.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {daRicontattare.slice(0, 9).map((l) => (
                <Link key={l.id} to={`/crm/lead/${l.id}`} className="p-3 rounded-lg bg-warning/10 hover:bg-warning/15 transition-colors">
                  <p className="text-sm font-medium">{l.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.prossima_azione_il
                      ? `${l.prossima_azione_il < oggi ? "In ritardo dal" : "Oggi,"} ${formatData(l.prossima_azione_il, "giornoBreve")}${l.prossima_azione_nota ? ` — ${l.prossima_azione_nota}` : ""}`
                      : `Mai richiamato — arrivato il ${formatData(l.created_date, "giornoBreve")}`}
                  </p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtra per stato">
        {FILTRI.map((f) => (
          <Button
            key={f.valore}
            role="tab"
            aria-selected={filtro === f.valore}
            size="sm"
            variant={filtro === f.valore ? "default" : "outline"}
            onClick={() => setFiltro(f.valore)}
          >
            {f.etichetta}
            <span className="ml-1.5 text-xs opacity-70">{conteggi[f.valore]}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Nome, telefono o email..." value={cerca} onChange={(e) => setCerca(e.target.value)} className="pl-9" />
        </div>
        <Select value={corso} onValueChange={setCorso}>
          <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TUTTI_I_CORSI}>Tutti i corsi</SelectItem>
            {corsi.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title={leads.length === 0 ? "Nessun lead ancora" : "Nessun lead corrisponde"}
          description={
            leads.length === 0
              ? "Chi chiede informazioni, al banco, al telefono o sui social, si registra qui: da lì gli si prenota una prova."
              : "Prova a cambiare stato, corso o ricerca."
          }
        />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left bg-muted/30">
                <th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Corso di interesse</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Fonte</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Da ricontattare</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Arrivato</th>
              </tr>
            </thead>
            <tbody>
              {visibili.map((l) => {
                const inRitardo = l.prossima_azione_il && l.prossima_azione_il < oggi && !statoChiuso(l.stato);
                return (
                  <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-3 px-4">
                      <Link to={`/crm/lead/${l.id}`} className="font-medium text-primary hover:underline">{l.full_name}</Link>
                      {l.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Phone className="w-3 h-3" aria-hidden="true" />{l.phone}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4"><StatusBadge status={l.stato} /></td>
                    <td className="py-3 px-4">{nomeCorso.get(l.corso_interesse_id) ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-3 px-4 text-muted-foreground">{etichettaFonte(l.fonte)}</td>
                    <td className={`py-3 px-4 ${inRitardo ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {statoChiuso(l.stato) ? "—" : formatData(l.prossima_azione_il, "giornoBreve")}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{formatData(l.created_date, "giornoBreve")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!nuovo} onOpenChange={(aperto) => !aperto && setNuovo(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo lead</DialogTitle></DialogHeader>
          {nuovo && (
            <form onSubmit={crea} className="space-y-4">
              <CampiLead valori={nuovo} onChange={setNuovo} corsi={corsi} compatto />
              <Button type="submit" className="w-full" disabled={salvando}>
                {salvando ? "Salvataggio..." : "Registra e apri la scheda"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
