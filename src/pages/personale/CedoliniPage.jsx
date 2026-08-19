import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AllegatiScrittura from "@/components/accounting/AllegatiScrittura";
import { Plus, Check, AlertTriangle, Info, Pencil, Trash2, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";

const MESI = moment.months();
const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 });
const num = (v) => Number(v) || 0;
const TOLLERANZA = 0.02;

const emptyForm = {
  collaboratore_id: "", retribuzione_lorda: "", netto_dipendente: "",
  ritenute_irpef: "", contributi_dipendente: "", trattenute_terzi: "",
  contributi_azienda: "", accantonamento_tfr: "", note: "",
};

/**
 * Cedolini del mese e loro registrazione in contabilità.
 *
 * Il cedolino lo calcola il consulente del lavoro: qui si trascrivono le voci macro che
 * servono alla contabilità. Il costo per l'associazione non coincide né con il lordo né
 * con il netto, e queste voci servono proprio a ricostruirlo.
 */
export default function CedoliniPage() {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();

  const [anno, setAnno] = useState(moment().year());
  const [mese, setMese] = useState(moment().month());
  const [dipendenti, setDipendenti] = useState([]);
  const [cedolini, setCedolini] = useState([]);
  const [registrazione, setRegistrazione] = useState(null);
  const [entryRegistrazione, setEntryRegistrazione] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [colls, ced, runs] = await Promise.all([
      api.entities.Collaboratore.filter({ organization_id: organization.id, attivo: true }),
      api.entities.Payslip.filter({ organization_id: organization.id, periodo_anno: anno, periodo_mese: mese }),
      api.entities.PayrollRun.filter({ organization_id: organization.id, periodo_anno: anno, periodo_mese: mese }),
    ]);
    // Gli stipendi riguardano i dipendenti: i collaboratori sportivi hanno un percorso
    // proprio, con i compensi e la soglia di esenzione.
    setDipendenti(colls.filter((c) => c.tipo_rapporto === "dipendente"));
    setCedolini(ced);
    const run = runs[0] || null;
    setRegistrazione(run);
    setEntryRegistrazione(run?.journal_entry_id ? await api.entities.JournalEntry.get(run.journal_entry_id).catch(() => null) : null);
    setLoading(false);
  }, [organization, anno, mese]);

  useEffect(() => { loadData(); }, [loadData]);

  const dipById = new Map(dipendenti.map((d) => [d.id, d]));

  // Le due identità che rendono verificabile la trascrizione. La prima dice se il cedolino
  // è stato letto bene, la seconda quanto costa davvero quella persona.
  const coerenza = (c) => {
    const somma = num(c.netto_dipendente) + num(c.ritenute_irpef) + num(c.contributi_dipendente) + num(c.trattenute_terzi);
    return { somma, scarto: somma - num(c.retribuzione_lorda) };
  };
  const costoDi = (c) => num(c.retribuzione_lorda) + num(c.contributi_azienda) + num(c.accantonamento_tfr);

  const totali = useMemo(() => cedolini.reduce((a, c) => ({
    lordo: a.lordo + num(c.retribuzione_lorda),
    netto: a.netto + num(c.netto_dipendente),
    irpef: a.irpef + num(c.ritenute_irpef),
    contributiDip: a.contributiDip + num(c.contributi_dipendente),
    terzi: a.terzi + num(c.trattenute_terzi),
    contributiAz: a.contributiAz + num(c.contributi_azienda),
    tfr: a.tfr + num(c.accantonamento_tfr),
    costo: a.costo + costoDi(c),
  }), { lordo: 0, netto: 0, irpef: 0, contributiDip: 0, terzi: 0, contributiAz: 0, tfr: 0, costo: 0 }), [cedolini]);

  const incoerenti = cedolini.filter((c) => Math.abs(coerenza(c).scarto) > TOLLERANZA);
  const registrato = !!registrazione;

  const scartoForm = useMemo(() => {
    const somma = num(form.netto_dipendente) + num(form.ritenute_irpef) + num(form.contributi_dipendente) + num(form.trattenute_terzi);
    return { somma, scarto: somma - num(form.retribuzione_lorda) };
  }, [form]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      collaboratore_id: c.collaboratore_id,
      retribuzione_lorda: String(c.retribuzione_lorda ?? ""),
      netto_dipendente: String(c.netto_dipendente ?? ""),
      ritenute_irpef: String(c.ritenute_irpef ?? ""),
      contributi_dipendente: String(c.contributi_dipendente ?? ""),
      trattenute_terzi: String(c.trattenute_terzi ?? ""),
      contributi_azienda: String(c.contributi_azienda ?? ""),
      accantonamento_tfr: String(c.accantonamento_tfr ?? ""),
      note: c.note || "",
    });
    setShowForm(true);
  };

  const salva = async (e) => {
    e.preventDefault();
    const payload = {
      organization_id: organization.id,
      collaboratore_id: form.collaboratore_id,
      periodo_anno: anno, periodo_mese: mese,
      retribuzione_lorda: num(form.retribuzione_lorda),
      netto_dipendente: num(form.netto_dipendente),
      ritenute_irpef: num(form.ritenute_irpef),
      contributi_dipendente: num(form.contributi_dipendente),
      trattenute_terzi: num(form.trattenute_terzi),
      contributi_azienda: num(form.contributi_azienda),
      accantonamento_tfr: num(form.accantonamento_tfr),
      note: form.note || null,
    };
    try {
      if (editing) await api.entities.Payslip.update(editing.id, payload);
      else await api.entities.Payslip.create(payload);
      setShowForm(false); setEditing(null); setForm(emptyForm);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const elimina = async (c) => {
    try { await api.entities.Payslip.delete(c.id); loadData(); }
    catch (err) { toast({ title: "Errore", description: err.message, variant: "destructive" }); }
  };

  const registra = async () => {
    setSaving(true);
    try {
      await api.accounting.createPayrollRun({
        organization_id: organization.id, periodo_anno: anno, periodo_mese: mese,
      });
      toast({ title: "Stipendi registrati", description: "Allega i cedolini alla scrittura per conservare il dettaglio." });
      loadData();
    } catch (err) {
      toast({ title: "Registrazione non riuscita", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-3">
          <div className="w-40">
            <Label className="text-xs">Mese</Label>
            <Select value={String(mese)} onValueChange={(v) => setMese(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MESI.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <Label className="text-xs">Anno</Label>
            <Select value={String(anno)} onValueChange={(v) => setAnno(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[anno - 1, anno, anno + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {!registrato && (
          <Button size="sm" onClick={openCreate} disabled={dipendenti.length === 0}>
            <Plus className="w-4 h-4 mr-1" /> Cedolino
          </Button>
        )}
      </div>

      {dipendenti.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nessun dipendente in anagrafica. I collaboratori sportivi non compaiono qui: i loro compensi
          si gestiscono in Compensi, con la soglia di esenzione.
        </p>
      )}

      {cedolini.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-heading font-semibold">Costo del mese</p>
              <p className="text-2xl font-bold">€{fmt(totali.costo)}</p>
            </div>
            {/* Il punto che rende leggibile il costo del personale: quanto esce, a chi, e
                quanto non è nemmeno nel cedolino. */}
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Retribuzioni lorde</span><span>€{fmt(totali.lordo)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Contributi a carico ente</span><span>€{fmt(totali.contributiAz)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Accantonamento TFR</span><span>€{fmt(totali.tfr)}</span></div>
              <div className="flex justify-between font-medium"><span>Costo totale</span><span>€{fmt(totali.costo)}</span></div>
            </div>
            <div className="pt-3 border-t border-border grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
              <p className="sm:col-span-2 text-xs text-muted-foreground uppercase tracking-wide">Di cui, del lordo, va a</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Dipendenti (netto in busta)</span><span>€{fmt(totali.netto)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Erario (IRPEF)</span><span>€{fmt(totali.irpef)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">INPS (quota dipendente)</span><span>€{fmt(totali.contributiDip)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Terzi (cessione del quinto e simili)</span><span>€{fmt(totali.terzi)}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {incoerenti.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {incoerenti.length} {incoerenti.length === 1 ? "cedolino non quadra" : "cedolini non quadrano"}:
            netto, IRPEF, contributi del dipendente e trattenute devono sommare al lordo. Correggili
            prima di registrare, altrimenti l'errore finisce in contabilità.
          </span>
        </div>
      )}

      {cedolini.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">Nessun cedolino per {MESI[mese]} {anno}</p>
      ) : (
        <div className="space-y-2">
          {cedolini.map((c) => {
            const d = dipById.get(c.collaboratore_id);
            const { scarto } = coerenza(c);
            const quadra = Math.abs(scarto) <= TOLLERANZA;
            return (
              <Card key={c.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{d ? `${d.nome} ${d.cognome}` : "Dipendente rimosso"}</p>
                    <p className="text-xs text-muted-foreground">
                      Lordo €{fmt(c.retribuzione_lorda)} · netto €{fmt(c.netto_dipendente)}
                      {num(c.trattenute_terzi) > 0 && ` · trattenute a terzi €${fmt(c.trattenute_terzi)}`}
                    </p>
                    {!quadra && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        Non quadra di €{fmt(Math.abs(scarto))}: le voci {scarto > 0 ? "superano" : "non raggiungono"} il lordo.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">costo per l'ente</p>
                      <p className="font-bold">€{fmt(costoDi(c))}</p>
                    </div>
                    {!registrato && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => elimina(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Registrazione */}
      {cedolini.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-3">
            {registrato ? (
              <>
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <p className="font-medium">Stipendi registrati in contabilità</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Una sola scrittura per il mese, per non riempire il registro. Il dettaglio per
                  dipendente si conserva allegando qui i cedolini, uno per persona.
                </p>
                {entryRegistrazione && (
                  <div className="flex items-center gap-2">
                    <AllegatiScrittura entry={entryRegistrazione} caricatoDa={staffUser?.nome} />
                    <span className="text-sm text-muted-foreground">Cedolini allegati alla scrittura</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    La registrazione genera <strong>una sola scrittura</strong> per il mese: costi da una
                    parte, debiti verso dipendenti, erario, INPS e terzi dall'altra, ciascuno con la sua
                    scadenza in Scadenzario. Dopo potrai allegarvi i cedolini.
                  </span>
                </div>
                <Button onClick={registra} disabled={saving || incoerenti.length > 0}>
                  <Check className="w-4 h-4 mr-1" />
                  {saving ? "Registrazione…" : "Registra in contabilità"}
                </Button>
                {incoerenti.length > 0 && (
                  <p className="text-xs text-muted-foreground">Correggi prima i cedolini che non quadrano.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Form cedolino */}
      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifica cedolino" : `Cedolino ${MESI[mese]} ${anno}`}</DialogTitle></DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            <div>
              <Label>Dipendente *</Label>
              <Select value={form.collaboratore_id} onValueChange={(v) => setForm({ ...form, collaboratore_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {dipendenti.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome} {d.cognome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="p-3 rounded-lg border border-border space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Composizione del lordo</p>
              <div><Label>Retribuzione lorda *</Label><Input type="number" step="0.01" required value={form.retribuzione_lorda} onChange={(e) => setForm({ ...form, retribuzione_lorda: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Netto in busta *</Label><Input type="number" step="0.01" required value={form.netto_dipendente} onChange={(e) => setForm({ ...form, netto_dipendente: e.target.value })} /></div>
                <div><Label>Ritenute IRPEF</Label><Input type="number" step="0.01" value={form.ritenute_irpef} onChange={(e) => setForm({ ...form, ritenute_irpef: e.target.value })} /></div>
                <div><Label>Contributi dipendente</Label><Input type="number" step="0.01" value={form.contributi_dipendente} onChange={(e) => setForm({ ...form, contributi_dipendente: e.target.value })} /></div>
                <div><Label>Trattenute a terzi</Label><Input type="number" step="0.01" value={form.trattenute_terzi} onChange={(e) => setForm({ ...form, trattenute_terzi: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">
                Cessione del quinto, quote sindacali, pignoramenti: non sono un costo dell'ente, sono
                denaro del dipendente che gira a qualcun altro.
              </p>
              {/* Il controllo appare mentre si digita: un errore di trascrizione va visto ora,
                  non quando la scrittura è già in contabilità. */}
              {num(form.retribuzione_lorda) > 0 && (
                <div className={`text-xs p-2 rounded ${Math.abs(scartoForm.scarto) <= TOLLERANZA ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                  {Math.abs(scartoForm.scarto) <= TOLLERANZA
                    ? `Le voci sommano al lordo: €${fmt(scartoForm.somma)}.`
                    : `Le voci sommano a €${fmt(scartoForm.somma)}, il lordo è €${fmt(form.retribuzione_lorda)}: mancano €${fmt(Math.abs(scartoForm.scarto))}.`}
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg border border-border space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Costi fuori dal cedolino</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Contributi a carico ente</Label><Input type="number" step="0.01" value={form.contributi_azienda} onChange={(e) => setForm({ ...form, contributi_azienda: e.target.value })} /></div>
                <div><Label>Accantonamento TFR</Label><Input type="number" step="0.01" value={form.accantonamento_tfr} onChange={(e) => setForm({ ...form, accantonamento_tfr: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">
                Non compaiono in busta perché non riguardano il dipendente, ma sono costo dell'ente.
                L'INAIL non va qui: si registra una volta l'anno all'autoliquidazione.
              </p>
              {num(form.retribuzione_lorda) > 0 && (
                <p className="text-sm font-medium">
                  Costo per l'ente: €{fmt(num(form.retribuzione_lorda) + num(form.contributi_azienda) + num(form.accantonamento_tfr))}
                </p>
              )}
            </div>

            <div><Label>Note</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.collaboratore_id}>
              {editing ? "Salva" : "Aggiungi cedolino"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
