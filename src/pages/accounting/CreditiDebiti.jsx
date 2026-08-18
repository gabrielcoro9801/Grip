import React, { useState, useEffect, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useOrganization } from "@/hooks/useOrganization";
import { settleJournalEntry, settleLoanInstallment } from "@/lib/journalEntryEngine";
import { generateReceiptForJournalEntry } from "@/lib/receiptEngine";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

export default function CreditiDebiti() {
  const { organization, loading: orgLoading } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [members, setMembers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payTarget, setPayTarget] = useState(null); // { type: 'journal'|'installment', entry, installment, loan }
  const [payData, setPayData] = useState({ metodo_liquidita: "banca", data: new Date().toISOString().split("T")[0] });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(() => {
    if (!organization) return;
    Promise.all([
      base44.entities.JournalEntry.filter({ organization_id: organization.id, stato: "confermata" }, "-data_scadenza"),
      base44.entities.ChartOfAccount.filter({ organization_id: organization.id }),
      base44.entities.Loan.filter({ organization_id: organization.id }),
      base44.entities.Member.list(),
      base44.entities.AccountingSupplier.filter({ organization_id: organization.id }),
      base44.entities.Client.filter({ organization_id: organization.id }),
    ]).then(async ([e, a, l, m, s, cl]) => {
      const entryIds = e.map(x => x.id);
      let allLines = [];
      if (entryIds.length > 0) {
        allLines = await base44.entities.JournalLine.filter({});
        allLines = allLines.filter(l => entryIds.includes(l.journal_entry_id));
      }
      const loanIds = l.map(x => x.id);
      let insts = [];
      if (loanIds.length > 0) {
        insts = await base44.entities.LoanInstallment.filter({});
        insts = insts.filter(i => loanIds.includes(i.loan_id));
      }
      setEntries(e); setLines(allLines); setAccounts(a); setLoans(l); setInstallments(insts);
      setMembers(m); setSuppliers(s); setClients(cl); setLoading(false);
    });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const controparteName = (tipo, id) => {
    if (!id) return null;
    if (tipo === "cliente") {
      const cl = clients.find(c => c.id === id);
      if (!cl) return "Cliente";
      const name = cl.tipo === "azienda" ? cl.ragione_sociale : [cl.nome, cl.cognome].filter(Boolean).join(" ");
      const isSocio = members.some(m => m.cliente_id === cl.id);
      return isSocio ? `${name} (socio)` : name;
    }
    if (tipo === "fornitore") return suppliers.find(s => s.id === id)?.ragione_sociale || "Fornitore";
    return null;
  };

  const daysRemaining = (dateStr) => {
    if (!dateStr) return null;
    const diff = moment(dateStr).diff(moment().startOf("day"), "days");
    return diff;
  };

  // Da incassare: JournalEntry con stato_pagamento=da_incassare
  const daIncassare = useMemo(() => {
    return entries
      .filter(e => e.stato_pagamento === "da_incassare")
      .map(e => {
        const entryLines = lines.filter(l => l.journal_entry_id === e.id);
        const controparteLine = entryLines.find(l => l.controparte_id);
        const importo = controparteLine?.dare || controparteLine?.avere || 0;
        const controparte = controparteName(controparteLine?.controparte_tipo, controparteLine?.controparte_id);
        return {
          id: e.id, type: "journal", descrizione: e.descrizione, importo,
          data_scadenza: e.data_scadenza, controparte,
          days: daysRemaining(e.data_scadenza),
        };
      })
      .sort((a, b) => (a.data_scadenza || "").localeCompare(b.data_scadenza || ""));
  }, [entries, lines, members, suppliers, clients]);

  // Da pagare: JournalEntry con stato_pagamento=da_pagare + LoanInstallment da_pagare
  const daPagare = useMemo(() => {
    const journalDebiti = entries
      .filter(e => e.stato_pagamento === "da_pagare")
      .map(e => {
        const entryLines = lines.filter(l => l.journal_entry_id === e.id);
        const controparteLine = entryLines.find(l => l.controparte_id);
        const importo = controparteLine?.dare || controparteLine?.avere || 0;
        const controparte = controparteName(controparteLine?.controparte_tipo, controparteLine?.controparte_id);
        return {
          id: e.id, type: "journal", descrizione: e.descrizione, importo,
          data_scadenza: e.data_scadenza, controparte,
          days: daysRemaining(e.data_scadenza),
        };
      });

    const loanDebiti = installments
      .filter(i => i.stato_pagamento === "da_pagare")
      .map(i => {
        const loan = loans.find(l => l.id === i.loan_id);
        return {
          id: i.id, type: "installment", descrizione: `Rata ${i.numero_rata} — ${loan?.ente_finanziatore || "Finanziamento"}`,
          importo: (i.quota_capitale || 0) + (i.quota_interessi || 0),
          data_scadenza: i.data_scadenza, controparte: loan?.ente_finanziatore,
          days: daysRemaining(i.data_scadenza),
          installment: i, loan,
        };
      });

    return [...journalDebiti, ...loanDebiti]
      .sort((a, b) => (a.data_scadenza || "").localeCompare(b.data_scadenza || ""));
  }, [entries, lines, installments, loans, members, suppliers, clients]);

  const handlePay = async () => {
    setSaving(true);
    try {
      if (payTarget.type === "journal") {
        const entry = entries.find(e => e.id === payTarget.id);
        await settleJournalEntry(entry, accounts, payData.metodo_liquidita, payData.data);
        // Genera ricevuta se era un incasso cliente precedentemente a credito
        if (entry.tipo_origine === "incasso_cliente") {
          try {
            await generateReceiptForJournalEntry(entry.id, organization, accounts);
          } catch (err) {
            toast({ title: "Ricevuta non generata", description: err.message, variant: "destructive" });
          }
        }
        toast({ title: "Pagamento registrato", description: entry.descrizione });
      } else if (payTarget.type === "installment") {
        await settleLoanInstallment(payTarget.installment, payTarget.loan, accounts, payData.metodo_liquidita, payData.data);
        toast({ title: "Rata pagata", description: payTarget.descrizione });
      }
      setPayTarget(null);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const canEdit = ["admin", "reception"].includes(staffUser?.ruolo);

  const renderRow = (item) => {
    const isOverdue = item.days !== null && item.days < 0;
    return (
      <tr key={`${item.type}-${item.id}`} className="border-b border-border/50 hover:bg-muted/30">
        <td className="py-3 px-4">{item.descrizione}</td>
        <td className="py-3 px-4 text-muted-foreground text-sm">{item.controparte || "—"}</td>
        <td className="py-3 px-4 text-right font-medium">€{Number(item.importo).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</td>
        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
          {item.data_scadenza ? moment(item.data_scadenza).format("DD/MM/YYYY") : "—"}
        </td>
        <td className="py-3 px-4">
          {isOverdue ? (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs"><AlertTriangle className="w-3 h-3 mr-1" />Scaduto da {Math.abs(item.days)}g</Badge>
          ) : item.days !== null ? (
            <Badge variant="outline" className="text-xs">{item.days}g rimanenti</Badge>
          ) : <span className="text-muted-foreground text-xs">—</span>}
        </td>
        <td className="py-3 px-4 text-right">
          {canEdit && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayTarget(item)}>
              Registra pagamento
            </Button>
          )}
        </td>
      </tr>
    );
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="incassare">
        <TabsList>
          <TabsTrigger value="incassare">Da incassare ({daIncassare.length})</TabsTrigger>
          <TabsTrigger value="pagare">Da pagare ({daPagare.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="incassare">
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Descrizione</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Controparte</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Importo</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Scadenza</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azione</th>
                </tr>
              </thead>
              <tbody>
                {daIncassare.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nessun credito da incassare</td></tr>
                ) : daIncassare.map(renderRow)}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="pagare">
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Descrizione</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Controparte</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Importo</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Scadenza</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azione</th>
                </tr>
              </thead>
              <tbody>
                {daPagare.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nessun debito da pagare</td></tr>
                ) : daPagare.map(renderRow)}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog: registra pagamento */}
      <Dialog open={!!payTarget} onOpenChange={(v) => { if (!v) setPayTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registra pagamento</DialogTitle></DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                <div className="font-medium">{payTarget.descrizione}</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Importo</span><span className="font-medium">€{Number(payTarget.importo).toFixed(2)}</span></div>
              </div>
              <div>
                <Label>Metodo pagamento</Label>
                <Select value={payData.metodo_liquidita} onValueChange={v => setPayData({ ...payData, metodo_liquidita: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cassa">Contanti (Cassa)</SelectItem>
                    <SelectItem value="banca">Bonifico (Banca)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Data pagamento</Label><Input type="date" value={payData.data} onChange={e => setPayData({ ...payData, data: e.target.value })} /></div>
              <Button className="w-full" onClick={handlePay} disabled={saving}>{saving ? "Registrazione..." : "Registra pagamento"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}