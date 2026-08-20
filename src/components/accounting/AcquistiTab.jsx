import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, PackageCheck, FileText, Ban, Receipt, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { ritenutaDovuta, calcolaRitenuta } from "../../../shared/ritenuta.js";
import moment from "moment";
import { useParametriFiscali } from "@/hooks/useParametriFiscali";

const oggi = () => new Date().toISOString().split("T")[0];

const emptyForm = {
  fornitore_id: "", data_ordine: oggi(), descrizione: "",
  importo_previsto: "", conto_costo_id: "", natura_fiscale: "promiscua", note: "",
};

// Lo stato "pagato" non è nel record: si legge dalla scrittura collegata. Tenerlo anche
// sull'ordine significherebbe avere due versioni della stessa verità.
const statoVisibile = (ordine, entryById) => {
  if (ordine.stato === "annullato") return "annullato";
  const entry = ordine.journal_entry_id ? entryById.get(ordine.journal_entry_id) : null;
  if (entry?.stato_pagamento === "saldata") return "pagato";
  return ordine.stato;
};

const STATI = {
  ordinato: { label: "Ordinato", classe: "bg-slate-100 text-slate-700 border-slate-200" },
  consegnato: { label: "Consegnato", classe: "bg-blue-50 text-blue-700 border-blue-200" },
  fatturato: { label: "Fatturato", classe: "bg-amber-50 text-amber-700 border-amber-200" },
  pagato: { label: "Pagato", classe: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  annullato: { label: "Annullato", classe: "bg-muted text-muted-foreground" },
};

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 });

export default function AcquistiTab({ organization, accounts, reloadMovimenti }) {
  const { toast } = useToast();
  const { dettaglio: dettaglioFiscale } = useParametriFiscali();
  // Anteprima della ritenuta: usa l'aliquota di oggi perché la consegna non è ancora
  // avvenuta. Al momento della consegna il server ricalcola con quella della data effettiva.
  const aliquotaRitenutaOrdinaria = dettaglioFiscale("aliquota_ritenuta_acconto", new Date().toISOString().slice(0, 10))?.valore;
  const [ordini, setOrdini] = useState([]);
  const [fornitori, setFornitori] = useState([]);
  const [entryById, setEntryById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [consegna, setConsegna] = useState(null);
  const [consegnaData, setConsegnaData] = useState({ data_consegna: oggi(), importo: "" });
  const [fattura, setFattura] = useState(null);
  const [fatturaData, setFatturaData] = useState({ numero_fattura: "", data_fattura: oggi(), importo_fatturato: "" });

  const contiCosto = accounts.filter((a) => a.tipo_conto === "costo" || a.tipo_conto === "attivo");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [o, f] = await Promise.all([
      api.entities.PurchaseOrder.filter({ organization_id: organization.id }, "-data_ordine"),
      api.entities.AccountingSupplier.filter({ organization_id: organization.id, attivo: true }),
    ]);
    // Serve lo stato di pagamento delle scritture collegate per sapere quali ordini
    // risultano già saldati.
    const ids = [...new Set(o.map((x) => x.journal_entry_id).filter(Boolean))];
    const entries = await Promise.all(ids.map((id) => api.entities.JournalEntry.get(id).catch(() => null)));
    setEntryById(new Map(entries.filter(Boolean).map((e) => [e.id, e])));
    setOrdini(o);
    setFornitori(f);
    setLoading(false);
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const fornitoreById = new Map(fornitori.map((f) => [f.id, f]));
  const contoById = new Map(accounts.map((a) => [a.id, a]));

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.entities.PurchaseOrder.create({
        ...form,
        organization_id: organization.id,
        importo_previsto: Number(form.importo_previsto),
        conto_costo_id: form.conto_costo_id || null,
      });
      toast({ title: "Ordine registrato", description: "Nessuna scrittura contabile: il costo nascerà alla consegna." });
      setShowForm(false);
      setForm(emptyForm);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const apriConsegna = (ordine) => {
    setConsegna(ordine);
    setConsegnaData({ data_consegna: oggi(), importo: String(ordine.importo_previsto ?? "") });
  };

  const confermaConsegna = async () => {
    try {
      await api.accounting.deliverPurchaseOrder(consegna.id, {
        data_consegna: consegnaData.data_consegna,
        importo: Number(consegnaData.importo),
        conto_costo_id: consegna.conto_costo_id,
      });
      toast({ title: "Consegna registrata", description: "Costo e debito verso il fornitore sono ora in contabilità." });
      setConsegna(null);
      loadData();
      reloadMovimenti?.();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const confermaFattura = async () => {
    try {
      await api.entities.PurchaseOrder.update(fattura.id, {
        stato: "fatturato",
        numero_fattura: fatturaData.numero_fattura,
        data_fattura: fatturaData.data_fattura,
        importo_fatturato: fatturaData.importo_fatturato === "" ? null : Number(fatturaData.importo_fatturato),
      });
      toast({ title: "Fattura registrata" });
      setFattura(null);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  const annulla = async (ordine) => {
    try {
      await api.entities.PurchaseOrder.update(ordine.id, { stato: "annullato" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Ordinare non è un fatto contabile: la scrittura nasce alla <strong>consegna</strong>, quando
            il costo sorge davvero. Il pagamento si registra poi da Scadenzario, come ogni altro debito.
          </span>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Nuovo ordine
        </Button>
      </div>

      {ordini.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">Nessun ordine registrato</p>
      ) : (
        <div className="space-y-3">
          {ordini.map((o) => {
            const stato = statoVisibile(o, entryById);
            const fornitore = fornitoreById.get(o.fornitore_id);
            const conto = contoById.get(o.conto_costo_id);
            const ritenuta = ritenutaDovuta(fornitore)
              ? calcolaRitenuta(fornitore, Number(o.importo_previsto) || 0, aliquotaRitenutaOrdinaria)
              : null;
            return (
              <Card key={o.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{o.descrizione}</p>
                        <Badge variant="outline" className={`text-xs ${STATI[stato].classe}`}>{STATI[stato].label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {fornitore?.ragione_sociale || "Fornitore rimosso"} · ordine del {moment(o.data_ordine).format("DD/MM/YYYY")}
                        {o.data_consegna && ` · consegnato il ${moment(o.data_consegna).format("DD/MM/YYYY")}`}
                      </p>
                      {conto && <p className="text-xs text-muted-foreground">Conto: {conto.codice} — {conto.nome}</p>}
                      {o.numero_fattura && (
                        <p className="text-xs text-muted-foreground">
                          Fattura {o.numero_fattura} del {moment(o.data_fattura).format("DD/MM/YYYY")}
                          {o.importo_fatturato != null && ` · €${fmt(o.importo_fatturato)}`}
                        </p>
                      )}
                      {ritenuta && stato !== "annullato" && (
                        <p className="text-xs text-purple-700 mt-1 flex items-center gap-1">
                          <Receipt className="w-3 h-3" />
                          Ritenuta {ritenuta.aliquota}%: al fornitore €{fmt(ritenuta.netto)}, all'erario €{fmt(ritenuta.ritenuta)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <p className="text-lg font-bold">€{fmt(o.importo_previsto)}</p>
                      <div className="flex gap-2">
                        {o.stato === "ordinato" && (
                          <>
                            <Button size="sm" onClick={() => apriConsegna(o)}>
                              <PackageCheck className="w-4 h-4 mr-1" /> Registra consegna
                            </Button>
                            <Button size="sm" variant="ghost" title="Annulla ordine" onClick={() => annulla(o)}>
                              <Ban className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {o.stato === "consegnato" && (
                          <Button size="sm" variant="outline" onClick={() => { setFattura(o); setFatturaData({ numero_fattura: "", data_fattura: oggi(), importo_fatturato: String(o.importo_previsto ?? "") }); }}>
                            <FileText className="w-4 h-4 mr-1" /> Registra fattura
                          </Button>
                        )}
                        {stato === "fatturato" && (
                          <span className="text-xs text-muted-foreground">Da saldare in Scadenzario</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Nuovo ordine */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo ordine a fornitore</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Fornitore *</Label>
              <Select value={form.fornitore_id} onValueChange={(v) => {
                const f = fornitoreById.get(v);
                setForm({ ...form, fornitore_id: v, conto_costo_id: form.conto_costo_id || f?.conto_costo_default_id || "" });
              }}>
                <SelectTrigger><SelectValue placeholder="Seleziona fornitore" /></SelectTrigger>
                <SelectContent>
                  {fornitori.map((f) => <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>)}
                </SelectContent>
              </Select>
              {fornitori.length === 0 && <p className="text-xs text-muted-foreground mt-1">Registra prima un fornitore.</p>}
            </div>
            <div><Label>Descrizione *</Label><Input required value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} placeholder="es. 10 tappetini" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Importo previsto (€) *</Label><Input type="number" step="0.01" required value={form.importo_previsto} onChange={(e) => setForm({ ...form, importo_previsto: e.target.value })} /></div>
              <div><Label>Data ordine *</Label><Input type="date" required value={form.data_ordine} onChange={(e) => setForm({ ...form, data_ordine: e.target.value })} /></div>
            </div>
            <div>
              <Label>Conto di costo *</Label>
              <Select value={form.conto_costo_id} onValueChange={(v) => setForm({ ...form, conto_costo_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona conto" /></SelectTrigger>
                <SelectContent>
                  {contiCosto.map((a) => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>A quale attività serve</Label>
              <Select value={form.natura_fiscale} onValueChange={(v) => setForm({ ...form, natura_fiscale: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="promiscua">Entrambe — costo promiscuo</SelectItem>
                  <SelectItem value="istituzionale">Solo attività istituzionale</SelectItem>
                  <SelectItem value="commerciale">Solo attività commerciale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Note</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!form.fornitore_id || !form.conto_costo_id}>Registra ordine</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Consegna */}
      <Dialog open={!!consegna} onOpenChange={(v) => !v && setConsegna(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registra consegna</DialogTitle></DialogHeader>
          {consegna && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Da qui nasce la scrittura contabile: il costo viene rilevato e il debito verso {fornitoreById.get(consegna.fornitore_id)?.ragione_sociale} resta aperto fino al pagamento.</span>
              </div>
              <div><Label>Data consegna *</Label><Input type="date" value={consegnaData.data_consegna} onChange={(e) => setConsegnaData({ ...consegnaData, data_consegna: e.target.value })} /></div>
              <div>
                <Label>Importo effettivo (€) *</Label>
                <Input type="number" step="0.01" value={consegnaData.importo} onChange={(e) => setConsegnaData({ ...consegnaData, importo: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">
                  Previsto all'ordine: €{fmt(consegna.importo_previsto)}. Correggilo se la fornitura ricevuta vale diversamente.
                </p>
              </div>
              <Button className="w-full" onClick={confermaConsegna}>Conferma consegna</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Fattura */}
      <Dialog open={!!fattura} onOpenChange={(v) => !v && setFattura(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registra fattura</DialogTitle></DialogHeader>
          {fattura && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Il costo è già stato rilevato alla consegna: qui si annotano gli estremi del documento,
                senza generare una seconda scrittura.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Numero fattura *</Label><Input value={fatturaData.numero_fattura} onChange={(e) => setFatturaData({ ...fatturaData, numero_fattura: e.target.value })} /></div>
                <div><Label>Data fattura *</Label><Input type="date" value={fatturaData.data_fattura} onChange={(e) => setFatturaData({ ...fatturaData, data_fattura: e.target.value })} /></div>
              </div>
              <div>
                <Label>Importo fatturato (€)</Label>
                <Input type="number" step="0.01" value={fatturaData.importo_fatturato} onChange={(e) => setFatturaData({ ...fatturaData, importo_fatturato: e.target.value })} />
                {Number(fatturaData.importo_fatturato) !== Number(fattura.importo_previsto) && fatturaData.importo_fatturato !== "" && (
                  <p className="text-xs text-amber-700 mt-1">
                    Diverso da quanto registrato alla consegna (€{fmt(fattura.importo_previsto)}): la differenza va sistemata
                    con una registrazione di rettifica, questa schermata non la corregge da sola.
                  </p>
                )}
              </div>
              <Button className="w-full" onClick={confermaFattura} disabled={!fatturaData.numero_fattura}>Registra fattura</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
