import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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
import { formatData, formatEuro } from "@/core/domain/format";
import {
  UNITA_DURATA, STATI_TIPO, NOTE_MASSIMO, descriviDurata, motivoCambioStatoNonValido, oggiIso, ordinaTipi,
} from "@/core/domain/abbonamenti";
import { paginaDi } from "@/core/domain/paginazione";
import Paginazione from "@/ui/Paginazione";

const MODULO_VUOTO = { name: "", price: "", durata_valore: "1", durata_unita: "mesi", vendibile_fino_al: "", description: "" };

// Cosa vuol dire ogni stato, detto a chi lo sceglie.
const SPIEGAZIONE_STATO = {
  attivo: "Si può vendere ai soci.",
  sospeso: "Non si vende per ora; si può riattivare quando serve.",
  annullato: "Non si vende più. È definitivo: non torna in vendita.",
};

const TUTTI = "tutti";
// Le tile fanno 3×4, come quelle dei soci.
const PER_PAGINA = 12;
const TONO_STATO = { attivo: "positivo", sospeso: "attesa", annullato: "neutro" };

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
  // Stato e pagina stanno nell'indirizzo, come nell'elenco soci. Cambiare stato riporta a pagina 1.
  const [parametri, setParametri] = useSearchParams();
  const filtroStato = STATI_TIPO.some((s) => s.valore === parametri.get("stato")) ? parametri.get("stato") : TUTTI;
  const pagina = Number(parametri.get("pagina")) || 1;
  const aggiorna = (cambi) => {
    const prossimi = new URLSearchParams(parametri);
    for (const [chiave, valore] of Object.entries(cambi)) {
      if (valore === null) prossimi.delete(chiave); else prossimi.set(chiave, valore);
    }
    setParametri(prossimi, { replace: true });
  };
  const cambiaPagina = (p) => {
    aggiorna({ pagina: p > 1 ? String(p) : null });
    window.scrollTo({ top: 0 });
  };

  const loadData = () => {
    api.entities.Plan.list().then(p => { setPlans(p); setLoading(false); });
  };
  useEffect(() => { loadData(); }, []);

  // In vendita, sospesi, ritirati; la vendita già chiusa in fondo al suo gruppo (ordinaTipi).
  const ordinati = useMemo(() => ordinaTipi(plans, oggiIso()).filter((p) => filtroStato === TUTTI || p.stato === filtroStato), [plans, filtroStato]);
  const conteggi = useMemo(() => Object.fromEntries(STATI_TIPO.map((s) => [s.valore, plans.filter((p) => p.stato === s.valore).length])), [plans]);
  const { righe, pagina: paginaVista } = paginaDi(ordinati, pagina, PER_PAGINA);

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
      await api.entities.Plan.create({
        ...form,
        price: Number(form.price),
        durata_valore: Number(form.durata_valore),
        vendibile_fino_al: form.vendibile_fino_al || null,
        description: form.description.trim() || null,
      });
      toast({ title: "Tipo aggiunto al listino" });
      setShowForm(false);
      setForm(MODULO_VUOTO);
      loadData();
    } catch (err) {
      toast({ title: "Tipo non aggiunto", description: err.message, variant: "destructive" });
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
        title: `Ritirare «${tipo.name}»?`,
        description:
          "Non si venderà più, e lo stato non si può riportare indietro: per rimetterlo in " +
          "listino bisognerà creare un tipo nuovo. Gli abbonamenti già venduti restano validi.",
        confirmLabel: "Ritira definitivamente",
        cancelLabel: "Non ritirare",
        destructive: true,
      });
      if (!ok) return;
    }

    setSalvando(true);
    try {
      await api.entities.Plan.update(tipo.id, { stato });
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
      <PageHeader title="Listino" description="I tipi di abbonamento che la palestra vende: si vendono ai soci dalla loro scheda">
        <Label htmlFor="stato-listino" className="sr-only">Stato</Label>
        <Select value={filtroStato} onValueChange={(v) => aggiorna({ stato: v === TUTTI ? null : v, pagina: null })}>
          <SelectTrigger id="stato-listino" className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TUTTI}>Tutti i tipi ({plans.length})</SelectItem>
            {STATI_TIPO.map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta} ({conteggi[s.valore]})</SelectItem>)}
          </SelectContent>
        </Select>
        {puoModificare && (
          <Button size="sm" onClick={() => { setForm(MODULO_VUOTO); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuovo tipo
          </Button>
        )}
      </PageHeader>

      {plans.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Il listino è vuoto"
          description="Qui si definiscono i tipi di abbonamento — prezzo, durata, fino a quando si vendono — da assegnare poi ai soci."
        />
      ) : ordinati.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nessun tipo in questo stato"
          description="Scegli «Tutti i tipi» per vedere l'intero listino."
        />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {righe.map(plan => {
          const venditaChiusa = plan.vendibile_fino_al && oggi > plan.vendibile_fino_al;
          return (
            // Altezza fissa e righe fisse: le note occupano sempre tre righe, piene o vuote, così
            // una nota lunga non allunga la sua tile né sposta le altre.
            <Card key={plan.id} className={`border-0 shadow-sm h-[216px] ${plan.stato === "annullato" ? "opacity-60" : ""}`}>
              <CardContent className="p-5 h-full flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-heading font-semibold truncate" title={plan.name}>{plan.name}</h3>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <StatusBadge status={plan.stato} label={STATI_TIPO.find((s) => s.valore === plan.stato)?.etichetta} tone={TONO_STATO[plan.stato]} />
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
                        ? `Vendita chiusa il ${formatData(plan.vendibile_fino_al, "lungo")}`
                        : `In vendita fino al ${formatData(plan.vendibile_fino_al, "lungo")}`}
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
      <Paginazione pagina={paginaVista} totale={ordinati.length} perPagina={PER_PAGINA} onCambia={cambiaPagina} />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuovo tipo di abbonamento</DialogTitle>
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
              {salvando ? "Creazione..." : "Aggiungi al listino"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cambioStato} onOpenChange={(aperta) => !aperta && setCambioStato(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stato del tipo</DialogTitle>
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
              <p className="text-xs text-muted-foreground">Gli abbonamenti già venduti non cambiano.</p>
              <Button
                type="submit"
                className="w-full"
                variant={cambioStato.stato === "annullato" ? "destructive" : "default"}
                disabled={cambioStato.stato === cambioStato.tipo.stato || salvando}
              >
                {salvando ? "Salvataggio..." : cambioStato.stato === "annullato" ? "Ritira definitivamente" : "Salva stato"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
