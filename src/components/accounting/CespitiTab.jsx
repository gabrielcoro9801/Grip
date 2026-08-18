import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useOrganization } from "@/hooks/useOrganization";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { logAction } from "@/lib/auditLog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, AlertTriangle } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

const STATO_LABEL = { in_uso: "In uso", dismesso: "Dismesso", venduto: "Venduto" };
const STATO_BADGE = {
  in_uso: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dismesso: "bg-slate-100 text-slate-600 border-slate-200",
  venduto: "bg-blue-100 text-blue-700 border-blue-200",
};

export default function CespitiTab({ accounts }) {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cessionTarget, setCessionTarget] = useState(null);
  const [cessionData, setCessionData] = useState({
    valore_vendita: "",
    data_vendita: new Date().toISOString().split("T")[0],
    acquirente: "",
    metodo_liquidita: "banca",
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(() => {
    if (!organization) return;
    base44.entities.FixedAsset.filter({ organization_id: organization.id }, "-data_acquisto")
      .then((a) => { setAssets(a); setLoading(false); });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const accountName = (id) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.codice} ${a.nome}` : "—";
  };

  const handleCession = async () => {
    setSaving(true);
    try {
      const asset = cessionTarget;
      const valoreVendita = Number(cessionData.valore_vendita);
      const costoStorico = asset.valore_acquisto;
      const differenza = valoreVendita - costoStorico;

      const findAccount = (codice) => accounts.find((a) => a.codice === codice);
      const contoLiquidita = cessionData.metodo_liquidita === "banca" ? findAccount("2.2") : findAccount("2.1");
      const contoPlusvalenza = findAccount("6.7");
      const contoMinusvalenza = findAccount("7.9");
      const contoCespite = accounts.find((a) => a.id === asset.conto_id);

      if (!contoLiquidita) throw new Error("Conto liquidità non trovato");
      if (!contoCespite) throw new Error("Conto originale del cespite non trovato");

      const lines = [];
      lines.push({ conto_id: contoLiquidita.id, dare: valoreVendita });
      if (differenza > 0) {
        if (!contoPlusvalenza) throw new Error("Conto 6.7 (Plusvalenze) non trovato nel piano dei conti");
        lines.push({ conto_id: contoCespite.id, avere: costoStorico });
        lines.push({ conto_id: contoPlusvalenza.id, avere: differenza });
      } else if (differenza < 0) {
        if (!contoMinusvalenza) throw new Error("Conto 7.9 (Minusvalenze) non trovato nel piano dei conti");
        lines.push({ conto_id: contoMinusvalenza.id, dare: -differenza });
        lines.push({ conto_id: contoCespite.id, avere: costoStorico });
      } else {
        lines.push({ conto_id: contoCespite.id, avere: costoStorico });
      }

      const existing = await base44.entities.JournalEntry.filter({ organization_id: organization.id }, "-numero_protocollo", 1);
      const numero_protocollo = (existing[0]?.numero_protocollo || 0) + 1;

      const entry = await base44.entities.JournalEntry.create({
        organization_id: organization.id,
        numero_protocollo,
        data_competenza: cessionData.data_vendita,
        data_cassa: cessionData.data_vendita,
        descrizione: `Cessione cespite: ${asset.nome}`,
        causale: "Cessione cespite",
        tipo_origine: "cespite_vendita",
        stato: "confermata",
        stato_pagamento: "saldata",
        natura_fiscale: "plusvalenza_patrimoniale",
      });

      await base44.entities.JournalLine.bulkCreate(
        lines.map((l) => ({
          journal_entry_id: entry.id,
          conto_id: l.conto_id,
          dare: l.dare || 0,
          avere: l.avere || 0,
        }))
      );

      await base44.entities.FixedAsset.update(asset.id, {
        stato: "venduto",
        data_vendita: cessionData.data_vendita,
        valore_vendita: valoreVendita,
        acquirente: cessionData.acquirente || undefined,
      });

      await logAction(
        staffUser,
        "cespite_vendita",
        "fixed_asset",
        asset.nome,
        asset.id,
        `Cessione per €${valoreVendita.toFixed(2)} (${differenza >= 0 ? "+" : ""}€${differenza.toFixed(2)})`
      );

      toast({
        title: "Cessione registrata",
        description: `${asset.nome} — ${differenza > 0 ? "Plusvalenza" : differenza < 0 ? "Minusvalenza" : "Pareggio"} €${Math.abs(differenza).toFixed(2)}`,
      });
      setCessionTarget(null);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const canEdit = ["admin", "reception"].includes(staffUser?.ruolo);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Nome</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Categoria</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Data acquisto</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Costo storico</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Vendita</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azione</th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Nessun cespite registrato</td></tr>
            ) : assets.map((a) => {
              const diff = a.stato === "venduto" && a.valore_vendita != null
                ? a.valore_vendita - a.valore_acquisto : null;
              return (
                <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 px-4 font-medium">{a.nome}</td>
                  <td className="py-3 px-4 text-muted-foreground">{accountName(a.conto_id)}</td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{a.data_acquisto ? moment(a.data_acquisto).format("DD/MM/YYYY") : "—"}</td>
                  <td className="py-3 px-4 text-right font-medium">€{Number(a.valore_acquisto || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
                  <td className="py-3 px-4">
                    <Badge className={`${STATO_BADGE[a.stato] || STATO_BADGE.in_uso} text-xs`}>{STATO_LABEL[a.stato] || "In uso"}</Badge>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                    {a.stato === "venduto" ? (
                      <div>
                        <div>{a.data_vendita ? moment(a.data_vendita).format("DD/MM/YYYY") : "—"}</div>
                        {diff !== null && (
                          <div className={diff >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                            {diff > 0 ? "+" : ""}€{diff.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {canEdit && a.stato !== "venduto" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                        setCessionTarget(a);
                        setCessionData({ valore_vendita: "", data_vendita: new Date().toISOString().split("T")[0], acquirente: "", metodo_liquidita: "banca" });
                      }}>
                        <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Registra cessione
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dialog: registra cessione */}
      <Dialog open={!!cessionTarget} onOpenChange={(v) => { if (!v) setCessionTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registra cessione cespite</DialogTitle></DialogHeader>
          {cessionTarget && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800">
                  Se la cessione di questo bene generi un obbligo IVA non è stato verificato in questa sessione — prima di confermare una cessione reale, verificare con il commercialista se è dovuta IVA sulla vendita, oltre alla plusvalenza già calcolata automaticamente qui.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                <div className="font-medium">{cessionTarget.nome}</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Costo storico</span><span className="font-medium">€{Number(cessionTarget.valore_acquisto).toFixed(2)}</span></div>
              </div>
              <div><Label>Valore di vendita (€) *</Label><Input type="number" step="0.01" required value={cessionData.valore_vendita} onChange={e => setCessionData({ ...cessionData, valore_vendita: e.target.value })} placeholder="0,00" /></div>
              <div><Label>Data vendita *</Label><Input type="date" required value={cessionData.data_vendita} onChange={e => setCessionData({ ...cessionData, data_vendita: e.target.value })} /></div>
              <div><Label>Acquirente (opzionale)</Label><Input value={cessionData.acquirente} onChange={e => setCessionData({ ...cessionData, acquirente: e.target.value })} placeholder="Nome / ragione sociale" /></div>
              <div>
                <Label>Metodo di liquidità</Label>
                <Select value={cessionData.metodo_liquidita} onValueChange={v => setCessionData({ ...cessionData, metodo_liquidita: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cassa">Contanti (Cassa)</SelectItem>
                    <SelectItem value="banca">Bonifico (Banca)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleCession} disabled={saving || !cessionData.valore_vendita}>
                {saving ? "Registrazione..." : "Conferma cessione"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}