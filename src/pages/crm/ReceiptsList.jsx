import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { regenerateReceiptPdf } from "@/lib/receiptEngine";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, RefreshCw, CheckCircle2, Clock, FileText } from "lucide-react";
import moment from "moment";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import { puo } from "@/lib/permissions";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData, formatEuro } from "@/lib/format";

export default function ReceiptsList() {
  const { organization } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [regenerating, setRegenerating] = useState(null);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const r = await api.entities.Receipt.filter({ organization_id: organization.id }, "-data_emissione");
    setReceipts(r);
    setLoading(false);
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRegenerate = async (id) => {
    setRegenerating(id);
    try {
      await regenerateReceiptPdf(id, organization);
      toast({ title: "Ricevuta rigenerata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setRegenerating(null);
  };

  const filtered = receipts.filter(r =>
    !search || (r.cliente_name || r.member_name || "").toLowerCase().includes(search.toLowerCase()) ||
    String(r.numero_progressivo || "").includes(search)
  );

  if (loading) return <LoadingState minHeight="h-64" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
      <PageHeader title="Ricevute" description={`${receipts.length} ricevute emesse`} />

      <div className="max-w-xs">
        <Label className="text-xs">Cerca per cliente o numero</Label>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Es. Mario Rossi o 42" />
      </div>

      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">N.</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Cliente</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Tipo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Importo</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Nessuna ricevuta</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 font-medium">{r.numero_progressivo || "—"}/{r.esercizio_fiscale || ""}</td>
                <td className="py-3 px-4 text-muted-foreground">{formatData(r.data_emissione || r.date)}</td>
                <td className="py-3 px-4">
                  <Link to={`/crm/members/${r.cliente_id || r.member_id}`} className="font-medium text-primary hover:underline">
                    {r.cliente_name || r.member_name}
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <Badge variant="outline" className="text-xs">
                    {r.tipo_documento === "ricevuta_fiscale" ? "Fiscale" : "Semplice"}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  {r.stato === "emessa" ? (
                    <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Emessa
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      <Clock className="w-3 h-3 mr-1" /> Bozza
                    </Badge>
                  )}
                  {r.versione > 1 && <span className="text-xs text-muted-foreground ml-1">v{r.versione}</span>}
                </td>
                <td className="py-3 px-4 text-right font-medium">{formatEuro(Number(r.importo_lordo || r.amount || 0))}</td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {r.pdf_url ? (
                      <a href={r.pdf_url} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost" className="h-7"><Download className="w-3.5 h-3.5" /></Button>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {puo(staffUser?.ruolo, "rigenerare_documento") && r.stato === "emessa" && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => handleRegenerate(r.id)} disabled={regenerating === r.id}>
                        <RefreshCw className={`w-3.5 h-3.5 ${regenerating === r.id ? "animate-spin" : ""}`} />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}