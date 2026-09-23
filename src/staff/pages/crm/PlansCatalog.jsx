import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { Plus, Pencil, Clock, CalendarClock, BookOpen } from "lucide-react";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { logAction } from "@/staff/lib/auditLog";
import { formatData, formatEuro } from "@/core/domain/format";
import {
  UNITA_DURATA, STATI_TIPO, NOTE_MASSIMO, descriviDurata, motivoCambioStatoNonValido, oggiIso,
} from "@/core/domain/abbonamenti";

const MODULO_VUOTO = { name: "", price: "", durata_valore: "1", durata_unita: "mesi", vendibile_fino_al: "", description: "" };

// Cosa vuol dire ogni stato, detto a chi lo sceglie.
const SPIEGAZIONE_STATO = {
  attivo: "Si può vendere ai soci.",
  sospeso: "Non si vende per ora; si può riattivare quando serve.",
  annullato: "Non si vende più. È definitivo: non si può riattivare.",
};

const ORDINE_STATO = { attivo: 0, sospeso: 1, annullato: 2 };

/**
 * Il catalogo dei tipi di abbonamento.
 *
 * Un tipo non si modifica né si elimina: nome, prezzo e durata sono quelli con cui le iscrizioni
 * sono state vendute, e cambiarli dopo avrebbe riscritto la storia di chi l'ha già comprato. Se
 * ne cambia solo lo stato. Il server impone le stesse regole (entities/hooks.js).
 */
export default function PlansCatalog() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const puoModificare = canEdit(staffUser?.ruolo, "crm_members");
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(MODULO_VUOTO);
  const [salvando, setSalvando] = useState(false);
  // Il tipo di cui si sta cambiando lo stato, con lo stato scelto.
  const [cambioStato, setCambioStato] = useState(null);

  const loadData = () => {
    api.entities.Plan.list().then(p => { setPlans(p); setLoading(false); });
  };
  useEffect(() => { loadData(); }, []);

  const ordinati = useMemo(() => [...plans].sort((a, b) =>
    (ORDINE_STATO[a.stato] ?? 3) - (ORDINE_STATO[b.stato] ?? 3) || a.name.localeCompare(b.name, "it")
  ), [plans]);

  const imposta = (campo) => (e) => {
    const valore = e.target.value;
    setForm((f) => ({ ...f, [campo]: valore }));
  };

  const durataValida = Number.isInteger(Number(form.durata_valore)) && Number(form.durata_valore) >= 1;
  const moduloCompleto = form.name.trim() && form.price !== "" && Number(form.price) >= 0 && durataValida;

  const crea = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const creato = await api.entities.Plan.create({
        ...form,
        price: Number(form.price),
        durata_valore: Number(form.durata_valore),
        vendibile_fino_al: form.vendibile_fino_al || null,
        description: form.description.trim() || null,
      });
      await logAction(staffUser, "create", "plan", creato.name, creato.id, "Abbonamento aggiunto al catalogo");
      toast({ title: "Abbonamento creato" });
      setShowForm(false);
      setForm(MODULO_VUOTO);
      loadData();
    } catch (err) {
      toast({ title: "Abbonamento non creato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const salvaStato = async (e) => {
    e.preventDefault();
    const { tipo, stato } = cambioStato;

    // Sospendere si disfa, annullare no: è l'unico cambio da cui non si torna indietro, e
    // nella finestra dello stato basta un menu e un clic per arrivarci. La seconda domanda
    // serve a rompere quel gesto automatico, e si fa solo qui — chiederla anche per
    // "sospeso" la renderebbe una porta da attraversare sempre, che si impara a spingere
    // senza leggere, e a quel punto non proteggerebbe più nemmeno l'annullamento.
    //
    // "Annulla" da solo qui vorrebbe dire due cose opposte, quindi i due pulsanti dicono
    // per esteso cosa fanno.
    if (stato === "annullato") {
      const ok = await conferma({
        title: `Annullare «${tipo.name}»?`,
        description:
          "Non si venderà più, e lo stato non si può riportare indietro: per rimetterlo in " +
          "catalogo bisognerà creare un abbonamento nuovo. Le iscrizioni già vendute restano valide.",
        confirmLabel: "Annulla definitivamente",
        cancelLabel: "Non annullare",
        destructive: true,
      });
      if (!ok) return;
    }

    setSalvando(true);
    try {
      await api.entities.Plan.update(tipo.id, { stato });
      await logAction(staffUser, "update", "plan", tipo.name, tipo.id, "Stato dell'abbonamento cambiato", tipo.stato, stato);
      toast({ title: "Stato aggiornato" });
      setCambioStato(null);
      loadData();
    } catch (err) {
      toast({ title: "Stato non aggiornato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  if (loading) return <LoadingState minHeight="h-64" />;

  const oggi = oggiIso();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {dialogoConferma}
      <PageHeader title="Catalogo abbonamenti" description="I tipi di abbonamento da vendere ai soci">
        {puoModificare && (
          <Button size="sm" onClick={() => { setForm(MODULO_VUOTO); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuovo abbonamento
          </Button>
        )}
      </PageHeader>

      {plans.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nessun abbonamento in catalogo"
          description="Qui si definiscono i tipi di abbonamento — prezzo, durata, fino a quando si vendono — da assegnare poi ai soci."
        />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ordinati.map(plan => {
          const venditaChiusa = plan.vendibile_fino_al && oggi > plan.vendibile_fino_al;
          return (
            // Altezza fissa e righe fisse: le note occupano sempre tre righe, piene o vuote, così
            // una nota lunga non allunga la sua tile né sposta le altre.
            <Card key={plan.id} className={`border-0 shadow-sm h-[216px] ${plan.stato === "annullato" ? "opacity-60" : ""}`}>
              <CardContent className="p-5 h-full flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-heading font-semibold truncate" title={plan.name}>{plan.name}</h3>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <StatusBadge status={plan.stato} />
                    {puoModificare && plan.stato !== "annullato" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Cambia lo stato di ${plan.name}`}
                        onClick={() => setCambioStato({ tipo: plan, stato: plan.stato })}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-2xl font-bold text-primary mt-1">{formatEuro(plan.price)}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {descriviDurata(plan.durata_valore, plan.durata_unita)}</span>
                  <span className={`flex items-center gap-1 ${venditaChiusa ? "text-destructive" : ""}`}>
                    <CalendarClock className="w-3 h-3" />
                    {!plan.vendibile_fino_al
                      ? "In vendita senza scadenza"
                      : venditaChiusa
                        ? `Vendita chiusa il ${formatData(plan.vendibile_fino_al, "media")}`
                        : `In vendita fino al ${formatData(plan.vendibile_fino_al, "media")}`}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-3 line-clamp-3 break-words leading-5 h-[3.75rem]" title={plan.description || undefined}>
                  {plan.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuovo abbonamento</DialogTitle>
            <DialogDescription>Dopo la creazione non si modifica: se ne cambia solo lo stato.</DialogDescription>
          </DialogHeader>
          <form onSubmit={crea} className="space-y-3">
            <div>
              <Label htmlFor="piano-nome">Nome *</Label>
              <Input id="piano-nome" required value={form.name} onChange={imposta("name")} />
            </div>
            <div>
              <Label htmlFor="piano-prezzo">Prezzo (€) *</Label>
              <Input id="piano-prezzo" type="number" min="0" step="0.01" required value={form.price} onChange={imposta("price")} />
            </div>
            <div>
              <Label htmlFor="piano-durata">Durata *</Label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input id="piano-durata" type="number" min="1" step="1" required value={form.durata_valore} onChange={imposta("durata_valore")} />
                <Select value={form.durata_unita} onValueChange={(u) => setForm((f) => ({ ...f, durata_unita: u }))}>
                  <SelectTrigger className="w-28" aria-label="Unità della durata"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITA_DURATA.map((u) => <SelectItem key={u.valore} value={u.valore}>{u.plurale}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground mt-1">I mesi sono di calendario: dal 16 settembre, un mese scade il 15 ottobre.</p>
            </div>
            <div>
              <Label htmlFor="piano-vendibile">In vendita fino al</Label>
              <Input id="piano-vendibile" type="date" min={oggi} value={form.vendibile_fino_al} onChange={imposta("vendibile_fino_al")} />
              <p className="text-xs text-muted-foreground mt-1">Vuoto: si vende senza scadenza. Altrimenti, dopo questa data non si vende più.</p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="piano-note">Note</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{form.description.length}/{NOTE_MASSIMO}</span>
              </div>
              <Textarea id="piano-note" rows={3} maxLength={NOTE_MASSIMO} value={form.description} onChange={imposta("description")} className="resize-none" />
            </div>
            <Button type="submit" className="w-full" disabled={!moduloCompleto || salvando}>
              {salvando ? "Creazione..." : "Crea abbonamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cambioStato} onOpenChange={(aperta) => !aperta && setCambioStato(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stato dell'abbonamento</DialogTitle>
            <DialogDescription>{cambioStato?.tipo.name}</DialogDescription>
          </DialogHeader>
          {cambioStato && (
            <form onSubmit={salvaStato} className="space-y-3">
              <div>
                <Label>Stato</Label>
                <Select value={cambioStato.stato} onValueChange={(stato) => setCambioStato((c) => ({ ...c, stato }))}>
                  <SelectTrigger aria-label="Stato"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATI_TIPO
                      .filter((s) => !motivoCambioStatoNonValido(cambioStato.tipo.stato, s.valore))
                      .map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className={`text-xs mt-1 ${cambioStato.stato === "annullato" ? "text-destructive" : "text-muted-foreground"}`}>
                  {SPIEGAZIONE_STATO[cambioStato.stato]}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Le iscrizioni già vendute non cambiano.</p>
              <Button
                type="submit"
                className="w-full"
                variant={cambioStato.stato === "annullato" ? "destructive" : "default"}
                disabled={cambioStato.stato === cambioStato.tipo.stato || salvando}
              >
                {salvando ? "Salvataggio..." : cambioStato.stato === "annullato" ? "Annulla definitivamente" : "Salva stato"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
