import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const FORMA_GIURIDICA = ["ASD (associazione non riconosciuta)", "ASD con personalità giuridica", "SSD (società di capitali)"];
const QUALIFICA_RUNTS = ["APS", "ODV", "Altro ente del Terzo Settore"];
const REGIME_FISCALE = ["Legge 398/1991", "Regime ordinario", "Regime forfetario art. 80 CTS", "Regime forfetario art. 86 CTS", "Non ancora definito"];

const today = () => new Date().toISOString().split("T")[0];
const defaultChiusura = () => `${new Date().getFullYear()}-12-31`;

const emptyForm = {
  data_decorrenza: today(),
  forma_giuridica: "",
  data_costituzione: "",
  data_chiusura_esercizio: defaultChiusura(),
  ente_affiliazione: "",
  numero_affiliazione: "",
  iscritta_rasd: undefined,
  numero_iscrizione_rasd: "",
  iscritta_runts: undefined,
  qualifica_runts: "",
  regime_fiscale: "",
  data_comunicazione_siae: "",
  data_opzione: "",
  partita_iva_posseduta: undefined,
  numero_partita_iva: "",
  data_apertura_partita_iva: "",
  note: "",
};

export default function SnapshotForm({ open, onClose, organization, currentSnapshot, editingSnapshot, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const isEdit = !!editingSnapshot;

  useEffect(() => {
    if (!open) return;
    const src = isEdit ? editingSnapshot : (currentSnapshot || {});
    setForm({
      ...emptyForm,
      data_decorrenza: src.data_decorrenza || today(),
      forma_giuridica: src.forma_giuridica || "",
      data_costituzione: src.data_costituzione || "",
      data_chiusura_esercizio: src.data_chiusura_esercizio || defaultChiusura(),
      ente_affiliazione: src.ente_affiliazione || "",
      numero_affiliazione: src.numero_affiliazione || "",
      iscritta_rasd: src.iscritta_rasd,
      numero_iscrizione_rasd: src.numero_iscrizione_rasd || "",
      iscritta_runts: src.iscritta_runts,
      qualifica_runts: src.qualifica_runts || "",
      regime_fiscale: src.regime_fiscale || "",
      data_comunicazione_siae: src.data_comunicazione_siae || "",
      data_opzione: src.data_opzione || "",
      partita_iva_posseduta: src.partita_iva_posseduta,
      numero_partita_iva: src.numero_partita_iva || "",
      data_apertura_partita_iva: src.data_apertura_partita_iva || "",
      note: src.note || "",
    });
  }, [open, editingSnapshot, currentSnapshot]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!organization?.id) { toast({ title: "Nessuna organizzazione", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { ...form, organization_id: organization.id };
      if (!isEdit) {
        payload.data_inserimento = new Date().toISOString();
        await base44.entities.FiscalProfileSnapshot.create(payload);
        toast({ title: "Snapshot registrato" });
      } else {
        await base44.entities.FiscalProfileSnapshot.update(editingSnapshot.id, payload);
        toast({ title: "Snapshot aggiornato" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const BoolSelect = ({ value, onChange }) => (
    <Select value={value != null ? String(value) : undefined} onValueChange={v => onChange(v === "true")}>
      <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value="true">Sì</SelectItem>
        <SelectItem value="false">No</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica snapshot" : "Registra un aggiornamento del profilo fiscale"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label>Data di decorrenza</Label>
            <Input type="date" value={form.data_decorrenza} onChange={e => set("data_decorrenza", e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Da quando questo assetto è valido</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Inquadramento giuridico</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Forma giuridica</Label>
                <Select value={form.forma_giuridica || undefined} onValueChange={v => set("forma_giuridica", v)}>
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>{FORMA_GIURIDICA.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Data costituzione ente</Label><Input type="date" value={form.data_costituzione} onChange={e => set("data_costituzione", e.target.value)} /></div>
              <div><Label>Chiusura esercizio sociale</Label><Input type="date" value={form.data_chiusura_esercizio} onChange={e => set("data_chiusura_esercizio", e.target.value)} /></div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Affiliazioni e registri</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Ente di affiliazione (FSN/DSA/EPS)</Label><Input value={form.ente_affiliazione} onChange={e => set("ente_affiliazione", e.target.value)} /></div>
              <div><Label>Numero affiliazione</Label><Input value={form.numero_affiliazione} onChange={e => set("numero_affiliazione", e.target.value)} /></div>
              <div><Label>Iscritta al RASD</Label><BoolSelect value={form.iscritta_rasd} onChange={v => set("iscritta_rasd", v)} /></div>
              {form.iscritta_rasd && <div><Label>Numero iscrizione RASD</Label><Input value={form.numero_iscrizione_rasd} onChange={e => set("numero_iscrizione_rasd", e.target.value)} /></div>}
              <div><Label>Iscritta al RUNTS</Label><BoolSelect value={form.iscritta_runts} onChange={v => set("iscritta_runts", v)} /></div>
              {form.iscritta_runts && (
                <div>
                  <Label>Qualifica RUNTS</Label>
                  <Select value={form.qualifica_runts || undefined} onValueChange={v => set("qualifica_runts", v)}>
                    <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                    <SelectContent>{QUALIFICA_RUNTS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Regime fiscale</p>
            <div>
              <Label>Regime applicato</Label>
              <Select value={form.regime_fiscale || undefined} onValueChange={v => set("regime_fiscale", v)}>
                <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>{REGIME_FISCALE.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.regime_fiscale === "Legge 398/1991" && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div><Label>Data comunicazione SIAE</Label><Input type="date" value={form.data_comunicazione_siae} onChange={e => set("data_comunicazione_siae", e.target.value)} /></div>
                <div><Label>Data di opzione</Label><Input type="date" value={form.data_opzione} onChange={e => set("data_opzione", e.target.value)} /></div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Partita IVA</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Partita IVA posseduta</Label><BoolSelect value={form.partita_iva_posseduta} onChange={v => set("partita_iva_posseduta", v)} /></div>
              {form.partita_iva_posseduta && (
                <>
                  <div><Label>Numero partita IVA</Label><Input value={form.numero_partita_iva} onChange={e => set("numero_partita_iva", e.target.value)} /></div>
                  <div><Label>Data apertura</Label><Input type="date" value={form.data_apertura_partita_iva} onChange={e => set("data_apertura_partita_iva", e.target.value)} /></div>
                </>
              )}
            </div>
          </div>

          <div><Label>Note libere</Label><Textarea value={form.note} onChange={e => set("note", e.target.value)} rows={3} /></div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : isEdit ? "Salva modifiche" : "Registra snapshot"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}