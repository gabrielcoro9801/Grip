import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { settleLoanInstallment } from "@/lib/journalEntryEngine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Landmark, CheckCircle2, Clock, ChevronDown, ChevronRight, Table2 } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { calcolaPianoAmmortamento, totaleInteressi, PERIODICITA } from "../../../shared/ammortamento.js";
import { LoadingState } from "@/components/shared/Spinner";
import { formatData, formatEuro, formatNumero } from "@/lib/format";

const oggi = () => new Date().toISOString().split("T")[0];

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
    banca_id: "", ente_finanziatore: "", capitale_erogato: "", tasso_interesse: "",
    data_inizio: oggi(), numero_rate_totali: "", periodicita: "mensile", note: "",
  });
  const [showInstallmentForm, setShowInstallmentForm] = useState(null); // loanId
  const [instForm, setInstForm] = useState({ numero_rata: "", data_scadenza: "", quota_capitale: "", quota_interessi: "" });
  const [banche, setBanche] = useState([]);
  const [showBancaForm, setShowBancaForm] = useState(false);
  const [bancaForm, setBancaForm] = useState({ nome: "", iban: "", referente: "", email: "", telefono: "" });
  const [pianoAperto, setPianoAperto] = useState(null); // loan di cui si sta guardando il piano

  const loadData = useCallback(() => {
    if (!organization) return;
    Promise.all([
      api.entities.Loan.filter({ organization_id: organization.id }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
      api.entities.Bank.filter({ organization_id: organization.id, attivo: true }),
    ]).then(async ([l, a, b]) => {
      const loanIds = l.map(x => x.id);
      let insts = [];
      if (loanIds.length > 0) {
        insts = await api.entities.LoanInstallment.filter({});
        insts = insts.filter(i => loanIds.includes(i.loan_id));
      }
      setLoans(l); setInstallments(insts); setAccounts(a); setBanche(b); setLoading(false);
    });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const bancaById = new Map(banche.map(b => [b.id, b]));
  const nomeEnte = (loan) => bancaById.get(loan.banca_id)?.nome || loan.ente_finanziatore;

  /** Piano teorico ricalcolato dai parametri: è una proiezione, non dati salvati. */
  const pianoDi = (loan) => calcolaPianoAmmortamento(
    Number(loan.capitale_erogato), Number(loan.tasso_interesse) || 0,
    Number(loan.numero_rate_totali), loan.data_inizio, loan.periodicita || "mensile",
  );

  const handleCreateBanca = async (e) => {
    e.preventDefault();
    const b = await api.entities.Bank.create({ ...bancaForm, organization_id: organization.id, attivo: true });
    toast({ title: "Banca registrata", description: b.nome });
    setShowBancaForm(false);
    setBancaForm({ nome: "", iban: "", referente: "", email: "", telefono: "" });
    setLoanForm(f => ({ ...f, banca_id: b.id }));
    loadData();
  };

  const handleCreateLoan = async (e) => {
    e.preventDefault();
    const banca = bancaById.get(loanForm.banca_id);
    await api.entities.Loan.create({
      organization_id: organization.id,
      banca_id: loanForm.banca_id || null,
      // Il nome resta anche come testo: se un domani la banca venisse rimossa
      // dall'anagrafica, il finanziamento continuerebbe a dire da chi proviene.
      ente_finanziatore: banca?.nome || loanForm.ente_finanziatore,
      capitale_erogato: Number(loanForm.capitale_erogato),
      tasso_interesse: Number(loanForm.tasso_interesse) || undefined,
      data_inizio: loanForm.data_inizio,
      numero_rate_totali: Number(loanForm.numero_rate_totali),
      periodicita: loanForm.periodicita,
      note: loanForm.note || undefined,
    });
    toast({ title: "Finanziamento creato", description: banca?.nome || loanForm.ente_finanziatore });
    setShowLoanForm(false);
    setLoanForm({ banca_id: "", ente_finanziatore: "", capitale_erogato: "", tasso_interesse: "", data_inizio: oggi(), numero_rate_totali: "", periodicita: "mensile", note: "" });
    loadData();
  };

  /**
   * Genera la sola rata successiva, precompilata dal piano teorico.
   * Le rate non vengono create tutte insieme: fino a quando non arriva la scadenza,
   * una rata è una previsione, non un debito da mostrare fra le scadenze aperte.
   */
  const generaProssimaRata = async (loan) => {
    const esistenti = installments.filter(i => i.loan_id === loan.id);
    const prossimoNumero = esistenti.length + 1;
    if (prossimoNumero > Number(loan.numero_rate_totali)) {
      toast({ title: "Piano completo", description: "Tutte le rate previste sono già state generate." });
      return;
    }
    const riga = pianoDi(loan).find(r => r.numero_rata === prossimoNumero);
    if (!riga) {
      toast({ title: "Impossibile calcolare la rata", description: "Verifica capitale, tasso e numero di rate.", variant: "destructive" });
      return;
    }
    setShowInstallmentForm(loan.id);
    setInstForm({
      numero_rata: String(riga.numero_rata),
      data_scadenza: riga.data_scadenza,
      quota_capitale: String(riga.quota_capitale),
      quota_interessi: String(riga.quota_interessi),
    });
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

  if (orgLoading || loading) return <LoadingState minHeight="h-full" />;

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
                      <h3 className="font-medium">{nomeEnte(loan)}</h3>
                      <p className="text-xs text-muted-foreground">
                        Capitale: {formatEuro(loan.capitale_erogato)} ·
                        {loan.tasso_interesse ? ` ${loan.tasso_interesse}% ·` : ""}
                        {" "}{PERIODICITA[loan.periodicita]?.label || "Mensile"} ·
                        Rate: {pagate.length}/{loan.numero_rate_totali}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{pagate.length} pagate</Badge>
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <p className="text-sm text-muted-foreground">
                        Rate generate: {loanInsts.length} di {loan.numero_rate_totali}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setPianoAperto(loan)}>
                          <Table2 className="w-3.5 h-3.5 mr-1" /> Piano di ammortamento
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => generaProssimaRata(loan)}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Genera prossima rata
                        </Button>
                      </div>
                    </div>

                    {loanInsts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">
                        Nessuna rata generata. Il piano completo è consultabile, ma le rate diventano
                        debiti da pagare solo quando le generi, una alla volta.
                      </p>
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
                                <td className="py-2 px-3 text-muted-foreground">{formatData(inst.data_scadenza)}</td>
                                <td className="py-2 px-3 text-right">{formatEuro(Number(inst.quota_capitale))}</td>
                                <td className="py-2 px-3 text-right">{formatEuro(Number(inst.quota_interessi))}</td>
                                <td className="py-2 px-3 text-right font-medium">{formatEuro((Number(inst.quota_capitale) + Number(inst.quota_interessi)))}</td>
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
            <div>
              <div className="flex items-center justify-between">
                <Label>Banca / ente finanziatore *</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowBancaForm(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Nuova banca
                </Button>
              </div>
              <Select value={loanForm.banca_id} onValueChange={v => setLoanForm({ ...loanForm, banca_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona banca" /></SelectTrigger>
                <SelectContent>
                  {banche.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {banche.length === 0 && <p className="text-xs text-muted-foreground mt-1">Registra prima una banca.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Capitale erogato (€) *</Label><Input type="number" step="0.01" required value={loanForm.capitale_erogato} onChange={e => setLoanForm({ ...loanForm, capitale_erogato: e.target.value })} /></div>
              <div><Label>Tasso interesse annuo (%)</Label><Input type="number" step="0.01" value={loanForm.tasso_interesse} onChange={e => setLoanForm({ ...loanForm, tasso_interesse: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data inizio *</Label><Input type="date" required value={loanForm.data_inizio} onChange={e => setLoanForm({ ...loanForm, data_inizio: e.target.value })} /></div>
              <div><Label>Numero rate totali *</Label><Input type="number" required value={loanForm.numero_rate_totali} onChange={e => setLoanForm({ ...loanForm, numero_rate_totali: e.target.value })} /></div>
            </div>
            <div>
              <Label>Periodicità delle rate *</Label>
              <Select value={loanForm.periodicita} onValueChange={v => setLoanForm({ ...loanForm, periodicita: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIODICITA).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Anteprima del piano prima di salvare: la rata è il dato che conta davvero
                per capire se il finanziamento è sostenibile. */}
            {(() => {
              const anteprima = calcolaPianoAmmortamento(
                Number(loanForm.capitale_erogato), Number(loanForm.tasso_interesse) || 0,
                Number(loanForm.numero_rate_totali), loanForm.data_inizio, loanForm.periodicita,
              );
              if (anteprima.length === 0) return null;
              return (
                <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Rata costante</span><span className="font-medium">{formatEuro(anteprima[0].rata)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interessi totali</span><span className="font-medium">{formatEuro(totaleInteressi(anteprima))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ultima scadenza</span><span className="font-medium">{formatData(anteprima[anteprima.length - 1].data_scadenza)}</span></div>
                </div>
              );
            })()}

            <div><Label>Note</Label><Textarea value={loanForm.note} onChange={e => setLoanForm({ ...loanForm, note: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={!loanForm.banca_id}>Crea finanziamento</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: nuova banca */}
      <Dialog open={showBancaForm} onOpenChange={setShowBancaForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuova banca</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateBanca} className="space-y-3">
            <div><Label>Nome *</Label><Input required value={bancaForm.nome} onChange={e => setBancaForm({ ...bancaForm, nome: e.target.value })} placeholder="es. Banca Popolare" /></div>
            <div><Label>IBAN</Label><Input value={bancaForm.iban} onChange={e => setBancaForm({ ...bancaForm, iban: e.target.value })} /></div>
            <div><Label>Referente</Label><Input value={bancaForm.referente} onChange={e => setBancaForm({ ...bancaForm, referente: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={bancaForm.email} onChange={e => setBancaForm({ ...bancaForm, email: e.target.value })} /></div>
              <div><Label>Telefono</Label><Input value={bancaForm.telefono} onChange={e => setBancaForm({ ...bancaForm, telefono: e.target.value })} /></div>
            </div>
            <Button type="submit" className="w-full">Registra banca</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: piano di ammortamento (proiezione ricalcolata, non dati salvati) */}
      <Dialog open={!!pianoAperto} onOpenChange={(v) => { if (!v) setPianoAperto(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Piano di ammortamento — {pianoAperto && nomeEnte(pianoAperto)}</DialogTitle>
          </DialogHeader>
          {pianoAperto && (() => {
            const piano = pianoDi(pianoAperto);
            const generate = installments.filter(i => i.loan_id === pianoAperto.id).length;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="p-3 rounded-lg bg-muted/40">
                    <p className="text-xs text-muted-foreground">Rata costante</p>
                    <p className="font-bold">{formatEuro(piano[0]?.rata)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/40">
                    <p className="text-xs text-muted-foreground">Interessi totali</p>
                    <p className="font-bold">{formatEuro(totaleInteressi(piano))}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/40">
                    <p className="text-xs text-muted-foreground">Totale da restituire</p>
                    <p className="font-bold">{formatEuro(Number(pianoAperto.capitale_erogato) + totaleInteressi(piano))}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proiezione calcolata su capitale, tasso e durata. Le rate già generate sono
                  evidenziate: quelle successive diventeranno debiti da pagare solo quando le genererai.
                </p>
                <div className="border border-border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60">
                      <tr className="border-b border-border text-left">
                        <th className="py-2 px-3 font-medium text-muted-foreground">Rata</th>
                        <th className="py-2 px-3 font-medium text-muted-foreground">Scadenza</th>
                        <th className="py-2 px-3 font-medium text-muted-foreground text-right">Capitale</th>
                        <th className="py-2 px-3 font-medium text-muted-foreground text-right">Interessi</th>
                        <th className="py-2 px-3 font-medium text-muted-foreground text-right">Rata</th>
                        <th className="py-2 px-3 font-medium text-muted-foreground text-right">Residuo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {piano.map(r => (
                        <tr key={r.numero_rata} className={`border-b border-border/50 ${r.numero_rata <= generate ? "bg-emerald-50/50" : ""}`}>
                          <td className="py-1.5 px-3">{r.numero_rata}</td>
                          <td className="py-1.5 px-3">{formatData(r.data_scadenza)}</td>
                          <td className="py-1.5 px-3 text-right">{formatEuro(r.quota_capitale)}</td>
                          <td className="py-1.5 px-3 text-right">{formatEuro(r.quota_interessi)}</td>
                          <td className="py-1.5 px-3 text-right font-medium">{formatEuro(r.rata)}</td>
                          <td className="py-1.5 px-3 text-right text-muted-foreground">{formatEuro(r.capitale_residuo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog: genera rata (precompilata dal piano, correggibile) */}
      <Dialog open={!!showInstallmentForm} onOpenChange={(v) => { if (!v) setShowInstallmentForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Genera rata</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Valori calcolati dal piano di ammortamento. Correggili se la banca ha applicato importi diversi.
          </p>
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
            <Button type="submit" className="w-full">Genera rata</Button>
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
                <div className="flex justify-between"><span className="text-muted-foreground">Totale</span><span className="font-medium">{formatEuro((Number(payTarget.installment.quota_capitale) + Number(payTarget.installment.quota_interessi)))}</span></div>
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
