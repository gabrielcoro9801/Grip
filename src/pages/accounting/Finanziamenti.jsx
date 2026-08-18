import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { settleLoanInstallment } from "@/lib/journalEntryEngine";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Landmark, CheckCircle2, Clock, ChevronDown, ChevronRight } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

export default function Finanziamenti() {
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [loans, setLoans] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [expandedLoan, setExpandedLoan] = useState(null);
  const [payTarget, setPayTarget] = useState(null); // { installment, loan }
  const [payData, setPayData] = useState({ metodo_liquidita: "banca", data: new Date().toISOString().split("T")[0] });
  const [saving, setSaving] = useState(false);
  const [loanForm, setLoanForm] = useState({
    ente_finanziatore: "", capitale_erogato: "", tasso_interesse: "",
    data_inizio: new Date().toISOString().split("T")[0], numero_rate_totali: "", note: "",
  });
  const [showInstallmentForm, setShowInstallmentForm] = useState(null); // loanId
  const [instForm, setInstForm] = useState({ numero_rata: "", data_scadenza: "", quota_capitale: "", quota_interessi: "" });

  const loadData = useCallback(() => {
    if (!organization) return;
    Promise.all([
      api.entities.Loan.filter({ organization_id: organization.id }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
    ]).then(async ([l, a]) => {
      const loanIds = l.map(x => x.id);
      let insts = [];
      if (loanIds.length > 0) {
        insts = await api.entities.LoanInstallment.filter({});
        insts = insts.filter(i => loanIds.includes(i.loan_id));
      }
      setLoans(l); setInstallments(insts); setAccounts(a); setLoading(false);
    });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateLoan = async (e) => {
    e.preventDefault();
    const loan = await api.entities.Loan.create({
      organization_id: organization.id,
      ente_finanziatore: loanForm.ente_finanziatore,
      capitale_erogato: Number(loanForm.capitale_erogato),
      tasso_interesse: Number(loanForm.tasso_interesse) || undefined,
      data_inizio: loanForm.data_inizio,
      numero_rate_totali: Number(loanForm.numero_rate_totali),
      note: loanForm.note || undefined,
    });
    toast({ title: "Finanziamento creato", description: loanForm.ente_finanziatore });
    setShowLoanForm(false);
    setLoanForm({ ente_finanziatore: "", capitale_erogato: "", tasso_interesse: "", data_inizio: new Date().toISOString().split("T")[0], numero_rate_totali: "", note: "" });
    loadData();
  };

  const handleAddInstallment = async (e) => {
    e.preventDefault();
    await api.entities.LoanInstallment.create({
      loan_id: showInstallmentForm,
      numero_rata: Number(instForm.numero_rata),
      data_scadenza: instForm.data_scadenza,
      quota_capitale: Number(instForm.quota_capitale),
      quota_interessi: Number(instForm.quota_interessi),
      stato_pagamento: "da_pagare",
    });
    toast({ title: "Rata aggiunta" });
    setShowInstallmentForm(null);
    setInstForm({ numero_rata: "", data_scadenza: "", quota_capitale: "", quota_interessi: "" });
    loadData();
  };

  const handlePayInstallment = async () => {
    setSaving(true);
    try {
      await settleLoanInstallment(payTarget.installment, payTarget.loan, accounts, payData.metodo_liquidita, payData.data);
      toast({ title: "Rata pagata", description: `Rata ${payTarget.installment.numero_rata} — ${payTarget.loan.ente_finanziatore}` });
      setPayTarget(null);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Finanziamenti" description="Mutui e prestiti con piano rate">
        <Button size="sm" onClick={() => setShowLoanForm(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo finanziamento</Button>
      </PageHeader>

      <div className="space-y-3">
        {loans.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun finanziamento registrato</p>
        ) : loans.map(loan => {
          const loanInsts = installments.filter(i => i.loan_id === loan.id).sort((a, b) => a.numero_rata - b.numero_rata);
          const pagate = loanInsts.filter(i => i.stato_pagamento === "pagata");
          const daPagare = loanInsts.filter(i => i.stato_pagamento === "da_pagare");
          const isExpanded = expandedLoan === loan.id;

          return (
            <Card key={loan.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <button
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => setExpandedLoan(isExpanded ? null : loan.id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <Landmark className="w-5 h-5 text-primary" />
                    <div>
                      <h3 className="font-medium">{loan.ente_finanziatore}</h3>
                      <p className="text-xs text-muted-foreground">
                        Capitale: €{Number(loan.capitale_erogato).toLocaleString("it-IT", { minimumFractionDigits: 2 })} ·
                        Rate: {pagate.length}/{loan.numero_rate_totali}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{pagate.length} pagate</Badge>
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-muted-foreground">Piano rate ({loanInsts.length} rate)</p>
                      <Button size="sm" variant="outline" onClick={() => { setShowInstallmentForm(loan.id); setInstForm({ numero_rata: String(loanInsts.length + 1), data_scadenza: "", quota_capitale: "", quota_interessi: "" }); }}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Rata
                      </Button>
                    </div>

                    {loanInsts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">Nessuna rata inserita</p>
                    ) : (
                      <div className="border border-border rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border text-left bg-muted/30">
                              <th className="py-2 px-3 font-medium text-muted-foreground">Rata</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground">Scadenza</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground text-right">Capitale</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground text-right">Interessi</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground text-right">Totale</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground">Stato</th>
                              <th className="py-2 px-3 font-medium text-muted-foreground text-right">Azione</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loanInsts.map(inst => (
                              <tr key={inst.id} className="border-b border-border/50">
                                <td className="py-2 px-3 font-medium">{inst.numero_rata}</td>
                                <td className="py-2 px-3 text-muted-foreground">{moment(inst.data_scadenza).format("DD/MM/YYYY")}</td>
                                <td className="py-2 px-3 text-right">€{Number(inst.quota_capitale).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right">€{Number(inst.quota_interessi).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right font-medium">€{(Number(inst.quota_capitale) + Number(inst.quota_interessi)).toFixed(2)}</td>
                                <td className="py-2 px-3">
                                  {inst.stato_pagamento === "pagata"
                                    ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />Pagata</Badge>
                                    : <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"><Clock className="w-2.5 h-2.5 mr-0.5" />Da pagare</Badge>}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {inst.stato_pagamento === "da_pagare" && (
                                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setPayTarget({ installment: inst, loan }); setPayData({ metodo_liquidita: "banca", data: new Date().toISOString().split("T")[0] }); }}>
                                      Paga
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {loan.note && <p className="text-xs text-muted-foreground pt-1">Note: {loan.note}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Dialog: nuovo finanziamento */}
      <Dialog open={showLoanForm} onOpenChange={setShowLoanForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo finanziamento</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateLoan} className="space-y-3">
            <div><Label>Ente finanziatore *</Label><Input required value={loanForm.ente_finanziatore} onChange={e => setLoanForm({ ...loanForm, ente_finanziatore: e.target.value })} placeholder="es. Unicredit" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Capitale erogato (€) *</Label><Input type="number" step="0.01" required value={loanForm.capitale_erogato} onChange={e => setLoanForm({ ...loanForm, capitale_erogato: e.target.value })} /></div>
              <div><Label>Tasso interesse (%)</Label><Input type="number" step="0.01" value={loanForm.tasso_interesse} onChange={e => setLoanForm({ ...loanForm, tasso_interesse: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data inizio *</Label><Input type="date" required value={loanForm.data_inizio} onChange={e => setLoanForm({ ...loanForm, data_inizio: e.target.value })} /></div>
              <div><Label>Numero rate totali *</Label><Input type="number" required value={loanForm.numero_rate_totali} onChange={e => setLoanForm({ ...loanForm, numero_rate_totali: e.target.value })} /></div>
            </div>
            <div><Label>Note</Label><Textarea value={loanForm.note} onChange={e => setLoanForm({ ...loanForm, note: e.target.value })} /></div>
            <Button type="submit" className="w-full">Crea finanziamento</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: aggiungi rata */}
      <Dialog open={!!showInstallmentForm} onOpenChange={(v) => { if (!v) setShowInstallmentForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Aggiungi rata</DialogTitle></DialogHeader>
          <form onSubmit={handleAddInstallment} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Numero rata *</Label><Input type="number" required value={instForm.numero_rata} onChange={e => setInstForm({ ...instForm, numero_rata: e.target.value })} /></div>
              <div><Label>Data scadenza *</Label><Input type="date" required value={instForm.data_scadenza} onChange={e => setInstForm({ ...instForm, data_scadenza: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quota capitale (€) *</Label><Input type="number" step="0.01" required value={instForm.quota_capitale} onChange={e => setInstForm({ ...instForm, quota_capitale: e.target.value })} /></div>
              <div><Label>Quota interessi (€) *</Label><Input type="number" step="0.01" required value={instForm.quota_interessi} onChange={e => setInstForm({ ...instForm, quota_interessi: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Inserisci i valori dal piano di ammortamento fornito dalla banca.</p>
            <Button type="submit" className="w-full">Aggiungi rata</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: paga rata */}
      <Dialog open={!!payTarget} onOpenChange={(v) => { if (!v) setPayTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registra pagamento rata</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {payTarget && (
              <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Rata</span><span className="font-medium">{payTarget.installment.numero_rata}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Totale</span><span className="font-medium">€{(Number(payTarget.installment.quota_capitale) + Number(payTarget.installment.quota_interessi)).toFixed(2)}</span></div>
              </div>
            )}
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
            <Button className="w-full" onClick={handlePayInstallment} disabled={saving}>{saving ? "Registrazione..." : "Registra pagamento"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}