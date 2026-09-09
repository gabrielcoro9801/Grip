import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { generateJournalEntry } from "@/lib/journalEntryEngine";
import { generateReceiptForJournalEntry } from "@/lib/receiptEngine";
import { generateInvoiceForJournalEntry } from "@/lib/invoiceEngine";
import { logAction } from "@/lib/auditLog";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CreditiDebiti from "@/pages/accounting/CreditiDebiti";
import PrimaNota from "@/pages/accounting/PrimaNota";
import AccountingSuppliers from "@/pages/accounting/AccountingSuppliers";
import IvaReport from "@/components/accounting/IvaReport";
import GestioneIstituzionaleReport from "@/components/accounting/GestioneIstituzionaleReport";
import AcquistiTab from "@/components/accounting/AcquistiTab";
import CassaBancaReport from "@/components/accounting/CassaBancaReport";
import FattureTab from "@/components/accounting/FattureTab";
import CespitiTab from "@/components/accounting/CespitiTab";
import PageHeader from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/Spinner";
import {
  Ticket, Users, Dumbbell, Package, Building, PlusCircle, Home, Zap,
  Truck, Landmark, Briefcase, MinusCircle, TrendingUp, TrendingDown,
  Wallet, ArrowLeft, ArrowRight, Download, CheckCircle2, Clock, Receipt
} from "lucide-react";
import { ritenutaDovuta, calcolaRitenuta } from "../../../shared/ritenuta.js";
import { trovaContoPerRuolo, ContoDiSistemaMancante } from "../../../shared/contiSistema.js";
import { useParametriFiscali } from "@/hooks/useParametriFiscali";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { formatData, formatEuro, toCsvNumber } from "@/lib/format";

const ICON_MAP = {
  ticket: Ticket, users: Users, dumbbell: Dumbbell, package: Package,
  building: Building, "plus-circle": PlusCircle, home: Home, zap: Zap,
  truck: Truck, landmark: Landmark, briefcase: Briefcase, "minus-circle": MinusCircle,
};

function CausaleIcon({ name, className }) {
  const Icon = ICON_MAP[name] || PlusCircle;
  return <Icon className={className} />;
}

export default function Movimenti() {
  const { organization, loading: orgLoading } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  // L'aliquota della ritenuta è quella in vigore alla data del movimento, non quella di oggi.
  const { dettaglio: dettaglioFiscale } = useParametriFiscali();
  const [causali, setCausali] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [clients, setClients] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTipo, setWizardTipo] = useState(null); // "entrata" | "uscita"
  const [selectedCausale, setSelectedCausale] = useState(null);
  const [wData, setWData] = useState({ importo: "", data: new Date().toISOString().split("T")[0], metodo_liquidita: "cassa" });
  const [aCredito, setACredito] = useState(false);
  const [dataScadenza, setDataScadenza] = useState("");
  const [controparteId, setControparteId] = useState("");
  const [controparteESocio, setControparteESocio] = useState(false);
  // Solo per le uscite: a quale attività serve il costo. "promiscua" è il caso più comune
  // in una palestra (affitto, utenze servono sia i soci sia l'attività commerciale).
  const [naturaCosto, setNaturaCosto] = useState("promiscua");
  const [eCespite, setECespite] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(() => {
    if (!organization) return;
    Promise.all([
      api.entities.CausaleOperativa.filter({ organization_id: organization.id, attivo: true }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
      api.entities.JournalEntry.filter({ organization_id: organization.id, stato: "confermata" }, "-data_competenza"),
      api.entities.AccountingSupplier.filter({ organization_id: organization.id, attivo: true }),
      api.entities.Client.filter({ organization_id: organization.id, attivo: true }),
      api.entities.Member.list(),
    ]).then(async ([c, acc, e, sup, cli, mem]) => {
      const entryIds = e.map(x => x.id);
      let allLines = [];
      if (entryIds.length > 0) {
        allLines = await api.entities.JournalLine.filter({});
        allLines = allLines.filter(l => entryIds.includes(l.journal_entry_id));
      }
      setCausali(c); setAccounts(acc); setEntries(e); setLines(allLines);
      setSuppliers(sup); setClients(cli); setMembers(mem);
      setLoading(false);
    });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  // Dashboard: calcola totali da JournalLine per conti di tipo ricavo/costo
  const totals = useMemo(() => {
    const accountTypeMap = new Map(accounts.map(a => [a.id, a.tipo_conto]));
    let entrate = 0, uscite = 0;
    lines.forEach(l => {
      const tipo = accountTypeMap.get(l.conto_id);
      if (!tipo) return;
      const date = entries.find(e => e.id === l.journal_entry_id)?.data_competenza;
      if (!date) return;
      if (dateFrom && date < dateFrom) return;
      if (dateTo && date > dateTo) return;
      if (tipo === "ricavo") entrate += (l.avere || 0);
      if (tipo === "costo") uscite += (l.dare || 0);
    });
    return { entrate, uscite, saldo: entrate - uscite };
  }, [lines, accounts, entries, dateFrom, dateTo]);

  const movimenti = useMemo(() => {
    const tipoConto = new Map(accounts.map(a => [a.id, a.tipo_conto]));
    return entries
      .filter(e => !dateFrom || e.data_competenza >= dateFrom)
      .filter(e => !dateTo || e.data_competenza <= dateTo)
      .map(e => {
        const entryLines = lines.filter(l => l.journal_entry_id === e.id);
        const totDare = entryLines.reduce((s, l) => s + (l.dare || 0), 0);
        const causale = causali.find(c => c.id === e.causale_operativa_id);

        // Il verso si ricava dalle righe, non dalla causale: saldi, compensi, cessioni
        // di cespiti e registrazioni manuali non hanno una causale, e prima di questo
        // venivano semplicemente esclusi dal registro — un registro contabile che omette
        // delle scritture non è un registro.
        const haRicavo = entryLines.some(l => tipoConto.get(l.conto_id) === "ricavo" && (l.avere || 0) > 0);
        const haCosto = entryLines.some(l => tipoConto.get(l.conto_id) === "costo" && (l.dare || 0) > 0);

        return {
          ...e,
          causaleObj: causale,
          importo: totDare,
          // Le scritture che non toccano ricavi né costi (per esempio il saldo di un
          // debito, che sposta solo valori patrimoniali) restano senza segno.
          isEntrata: causale ? causale.tipo === "entrata" : haRicavo,
          senzaSegno: !causale && !haRicavo && !haCosto,
          stato_pagamento: e.stato_pagamento,
        };
      });
  }, [entries, lines, causali, accounts, dateFrom, dateTo]);

  const openWizard = (tipo) => {
    setWizardTipo(tipo);
    setWizardStep(1);
    setSelectedCausale(null);
    setWData({ importo: "", data: new Date().toISOString().split("T")[0], metodo_liquidita: "cassa" });
    setACredito(false);
    setDataScadenza("");
    setControparteId("");
    setControparteESocio(false);
    setNaturaCosto("promiscua");
    setECespite(false);
    setWizardOpen(true);
  };

  const causaliFiltrate = causali.filter(c => c.tipo === wizardTipo);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const isIstituzionale = selectedCausale.puo_essere_istituzionale && controparteESocio;
      const virtualCausale = isIstituzionale
        ? { ...selectedCausale, gestisce_iva: false, aliquota_iva_default: 0 }
        : selectedCausale;
      // Sulle entrate la natura discende dall'essere il pagante un socio; sulle uscite
      // dall'attività che il costo serve, indicata esplicitamente.
      const natura_fiscale = selectedCausale.tipo === "uscita"
        ? naturaCosto
        : isIstituzionale ? "istituzionale" : "commerciale";

      // Se il fornitore è soggetto a ritenuta, una quota del compenso non gli spetta: va
      // versata all'erario. La scrittura lo riflette invece di limitarsi ad avvisare.
      const fornitorePagato = selectedCausale.tipo_controparte === "fornitore"
        ? suppliers.find(s => s.id === controparteId)
        : null;
      let ritenuta;
      if (ritenutaDovuta(fornitorePagato)) {
        const contoRitenuta = trovaContoPerRuolo(accounts, "erario_ritenute_autonomi");
        if (!contoRitenuta) throw new ContoDiSistemaMancante("erario_ritenute_autonomi");
        const aliquotaOrdinaria = dettaglioFiscale("aliquota_ritenuta_acconto", wData.data)?.valore;
        const { ritenuta: importo } = calcolaRitenuta(fornitorePagato, Number(wData.importo), aliquotaOrdinaria);
        ritenuta = { importo, conto_id: contoRitenuta.id };
      }

      const journalEntry = await generateJournalEntry({
        organization_id: organization.id,
        causale: virtualCausale,
        importo_lordo: Number(wData.importo),
        data: wData.data,
        metodo_liquidita: wData.metodo_liquidita,
        controparte_id: controparteId || undefined,
        controparte_tipo: selectedCausale.tipo_controparte,
        a_credito: aCredito,
        data_scadenza: dataScadenza || undefined,
        accounts,
        natura_fiscale,
        controparte_e_socio: selectedCausale.puo_essere_istituzionale ? controparteESocio : undefined,
        ritenuta,
      });
      // Il documento da emettere dipende da chi ha pagato: a un'azienda si emette fattura,
      // a un privato una ricevuta. Non bloccante: se la generazione fallisce, il movimento
      // resta registrato e il documento si può rigenerare.
      if (!aCredito && journalEntry.tipo_origine === "incasso_cliente") {
        const cliente = clients.find(c => c.id === controparteId);
        try {
          if (cliente?.tipo === "azienda") {
            await generateInvoiceForJournalEntry(journalEntry.id, organization, accounts);
          } else {
            await generateReceiptForJournalEntry(journalEntry.id, organization, accounts);
          }
        } catch (e) { /* non bloccante */ }
      }
      // Se uscita cespite, crea il FixedAsset collegato (logica già in Acquisti.jsx)
      if (eCespite && wizardTipo === "uscita") {
        await api.entities.FixedAsset.create({
          organization_id: organization.id,
          nome: selectedCausale.nome_visibile,
          valore_acquisto: Number(wData.importo),
          data_acquisto: wData.data,
          conto_id: selectedCausale.conto_contropartita_id,
        });
      }
      await logAction(staffUser, "create", selectedCausale.tipo === "entrata" ? "finance_revenue" : "finance_expense",
        selectedCausale.nome_visibile, null,
        `${selectedCausale.tipo === "entrata" ? "Entrata" : "Uscita"}: ${formatEuro(Number(wData.importo))}${aCredito ? " a credito" : ""}`);
      toast({ title: "Movimento registrato", description: selectedCausale.nome_visibile });
      setWizardOpen(false);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const exportCSV = () => {
    let csv = "Data,Descrizione,Tipo,Importo,Stato pagamento\n";
    movimenti.forEach(m => {
      csv += `${m.data_competenza},"${m.descrizione}",${m.isEntrata ? "Entrata" : "Uscita"},${m.isEntrata ? "+" : "-"}${toCsvNumber(m.importo)},${m.stato_pagamento}\n`;
    });
    csv += `\nRiepilogo,,,,\nTotale entrate,,${toCsvNumber(totals.entrate)},,\nTotale uscite,,${toCsvNumber(totals.uscite)},,\nSaldo netto,,${toCsvNumber(totals.saldo)},,\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimenti-${moment().format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (orgLoading || loading) return <LoadingState minHeight="h-full" />;

  const canEdit = ["admin", "reception"].includes(staffUser?.ruolo);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Movimenti" description="Registra entrate e uscite — la contabilità si aggiorna automaticamente">
        <Button size="sm" variant="outline" onClick={exportCSV}><Download className="w-4 h-4 mr-1" /> CSV</Button>
      </PageHeader>

      <Tabs defaultValue="registro">
        <TabsList>
          <TabsTrigger value="registro">Registro</TabsTrigger>
          <TabsTrigger value="scadenzario">Scadenzario</TabsTrigger>
          <TabsTrigger value="cassa">Cassa e banca</TabsTrigger>
          <TabsTrigger value="prima-nota">Prima Nota</TabsTrigger>
          <TabsTrigger value="acquisti">Acquisti</TabsTrigger>
          <TabsTrigger value="fatture">Fatture</TabsTrigger>
          <TabsTrigger value="fornitori">Fornitori</TabsTrigger>
          <TabsTrigger value="iva">IVA</TabsTrigger>
          <TabsTrigger value="istituzionale">Istituzionale</TabsTrigger>
          <TabsTrigger value="cespiti">Cespiti</TabsTrigger>
        </TabsList>

        <TabsContent value="registro" className="space-y-6 mt-4">
      {/* Dashboard cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Totale entrate</p>
                <p className="text-2xl font-bold text-emerald-600">{formatEuro(totals.entrate)}</p>
              </div>
              <div className="bg-emerald-50 p-2 rounded-lg"><TrendingUp className="w-5 h-5 text-emerald-600" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Totale uscite</p>
                <p className="text-2xl font-bold text-red-500">{formatEuro(totals.uscite)}</p>
              </div>
              <div className="bg-red-50 p-2 rounded-lg"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Saldo netto</p>
                <p className={`text-2xl font-bold ${totals.saldo >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatEuro(totals.saldo)}</p>
              </div>
              <div className="bg-blue-50 p-2 rounded-lg"><Wallet className="w-5 h-5 text-blue-600" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buttons */}
      {canEdit && (
        <div className="flex gap-3">
          <Button onClick={() => openWizard("entrata")} className="bg-emerald-600 hover:bg-emerald-700"><PlusCircle className="w-4 h-4 mr-1" /> Entrata</Button>
          <Button onClick={() => openWizard("uscita")} variant="destructive"><MinusCircle className="w-4 h-4 mr-1" /> Uscita</Button>
        </div>
      )}

      {/* Date filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">Dal</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">Al</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" /></div>
        {(dateFrom || dateTo) && <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Pulisci</Button>}
      </div>

      {/* Movimenti table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Descrizione</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Stato</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Importo</th>
            </tr>
          </thead>
          <tbody>
            {movimenti.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Nessun movimento</td></tr>
            ) : movimenti.map(m => (
              <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{formatData(m.data_competenza)}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    {m.causaleObj && <CausaleIcon name={m.causaleObj.icona} className="w-4 h-4 text-muted-foreground" />}
                    <span>{m.descrizione}</span>
                    {/* Le scritture manuali scavalcano le causali: vanno riconosciute a
                        colpo d'occhio quando si rilegge il registro. */}
                    {m.tipo_origine === "manuale" && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-800 text-xs"
                        title={m.motivo_manuale || undefined}
                      >
                        Manuale
                      </Badge>
                    )}
                  </div>
                  {m.tipo_origine === "manuale" && m.motivo_manuale && (
                    <p className="text-xs text-muted-foreground mt-0.5">{m.motivo_manuale}</p>
                  )}
                </td>
                <td className="py-3 px-4">
                  {m.stato_pagamento === "saldata" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Saldata</Badge>}
                  {m.stato_pagamento === "da_incassare" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs"><Clock className="w-3 h-3 mr-1" />Da incassare</Badge>}
                  {m.stato_pagamento === "da_pagare" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs"><Clock className="w-3 h-3 mr-1" />Da pagare</Badge>}
                </td>
                <td className={`py-3 px-4 text-right font-medium ${m.senzaSegno ? "text-muted-foreground" : m.isEntrata ? "text-emerald-600" : "text-red-500"}`}>
                  {m.senzaSegno ? "" : m.isEntrata ? "+" : "−"}{formatEuro(m.importo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

        </TabsContent>

        <TabsContent value="scadenzario" className="mt-4">
          <CreditiDebiti />
        </TabsContent>

        <TabsContent value="prima-nota" className="mt-4">
          <PrimaNota />
        </TabsContent>

        <TabsContent value="fornitori" className="mt-4">
          <AccountingSuppliers />
        </TabsContent>

        <TabsContent value="fatture" className="mt-4">
          <FattureTab organization={organization} />
        </TabsContent>

        <TabsContent value="cassa" className="mt-4">
          <CassaBancaReport entries={entries} lines={lines} accounts={accounts} />
        </TabsContent>

        <TabsContent value="acquisti" className="mt-4">
          <AcquistiTab organization={organization} accounts={accounts} reloadMovimenti={loadData} />
        </TabsContent>

        <TabsContent value="iva" className="mt-4">
          <IvaReport entries={entries} lines={lines} accounts={accounts} />
        </TabsContent>

        <TabsContent value="istituzionale" className="mt-4">
          <GestioneIstituzionaleReport entries={entries} lines={lines} accounts={accounts} />
        </TabsContent>

        <TabsContent value="cespiti" className="mt-4">
          <CespitiTab accounts={accounts} />
        </TabsContent>
      </Tabs>

      {/* Wizard Dialog */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {wizardStep === 1 && `Nuova ${wizardTipo === "entrata" ? "entrata" : "uscita"}`}
              {wizardStep === 2 && "Dettagli movimento"}
              {wizardStep === 3 && "Controparte"}
              {wizardStep === 4 && "Conferma"}
            </DialogTitle>
          </DialogHeader>

          {/* Step 1: scegli causale */}
          {wizardStep === 1 && (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {causaliFiltrate.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCausale(c); setWizardStep(2); setACredito(false); }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors text-left"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.tipo === "entrata" ? "bg-emerald-50" : "bg-red-50"}`}>
                    <CausaleIcon name={c.icona} className={`w-5 h-5 ${c.tipo === "entrata" ? "text-emerald-600" : "text-red-500"}`} />
                  </div>
                  <span className="font-medium">{c.nome_visibile}</span>
                </button>
              ))}
              {causaliFiltrate.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessuna causale disponibile</p>}
            </div>
          )}

          {/* Step 2: dettagli */}
          {wizardStep === 2 && selectedCausale && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedCausale.tipo === "entrata" ? "bg-emerald-50" : "bg-red-50"}`}>
                  <CausaleIcon name={selectedCausale.icona} className={`w-5 h-5 ${selectedCausale.tipo === "entrata" ? "text-emerald-600" : "text-red-500"}`} />
                </div>
                <span className="font-medium">{selectedCausale.nome_visibile}</span>
              </div>

              <div><Label>Importo (€) *</Label><Input type="number" step="0.01" required value={wData.importo} onChange={e => setWData({ ...wData, importo: e.target.value })} placeholder="0,00" /></div>
              <div><Label>Data *</Label><Input type="date" required value={wData.data} onChange={e => setWData({ ...wData, data: e.target.value })} /></div>

              {wizardTipo === "uscita" && (
                <div className="flex items-center gap-2">
                  <Checkbox id="e_cespite" checked={eCespite} onCheckedChange={c => setECespite(!!c)} />
                  <Label htmlFor="e_cespite" className="font-normal">È un cespite (immobilizzazione)</Label>
                </div>
              )}

              {selectedCausale.permette_a_credito && (
                <div className="space-y-3 p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <input type="radio" id="subito" checked={!aCredito} onChange={() => setACredito(false)} className="accent-primary" />
                    <Label htmlFor="subito" className="font-normal cursor-pointer">Pagato / incassato subito</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="radio" id="dopo" checked={aCredito} onChange={() => setACredito(true)} className="accent-primary" />
                    <Label htmlFor="dopo" className="font-normal cursor-pointer">Da pagare / incassare dopo</Label>
                  </div>
                </div>
              )}

              {!aCredito && (
                <div>
                  <Label>Metodo di pagamento</Label>
                  <Select value={wData.metodo_liquidita} onValueChange={v => setWData({ ...wData, metodo_liquidita: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cassa">Contanti (Cassa)</SelectItem>
                      <SelectItem value="banca">Bonifico / Carta (Banca)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {aCredito && <div><Label>Data scadenza</Label><Input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)} /></div>}

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setWizardStep(1)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
                <Button onClick={() => selectedCausale.richiede_controparte ? setWizardStep(3) : setWizardStep(4)} disabled={!wData.importo}>Avanti <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </div>
          )}

          {/* Step 3: controparte */}
          {wizardStep === 3 && selectedCausale && (
            <div className="space-y-4">
              <div>
                <Label>{selectedCausale.tipo_controparte === "cliente" ? "Cliente" : "Fornitore"}</Label>
                {selectedCausale.tipo_controparte === "cliente" ? (
                  <Select value={controparteId || "none"} onValueChange={v => {
                    const val = v === "none" ? "" : v;
                    setControparteId(val);
                    if (selectedCausale.puo_essere_istituzionale && val) {
                      const cl = clients.find(c => c.id === val);
                      setControparteESocio(!!(cl && members.find(m => m.cliente_id === cl.id)));
                    } else {
                      setControparteESocio(false);
                    }
                  }}>
                    <SelectTrigger><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Nessuno —</SelectItem>
                      {clients.map(cl => {
                        const linked = members.find(m => m.cliente_id === cl.id);
                        const name = cl.tipo === "azienda" ? cl.ragione_sociale : [cl.nome, cl.cognome].filter(Boolean).join(" ");
                        return <SelectItem key={cl.id} value={cl.id}>{linked ? `Associato: ${name}` : name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={controparteId || "none"} onValueChange={v => setControparteId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Seleziona fornitore" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Nessuno —</SelectItem>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.ragione_sociale}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {selectedCausale.puo_essere_istituzionale && selectedCausale.tipo_controparte === "cliente" && controparteId && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  <input
                    type="checkbox"
                    id="controparte_socio"
                    checked={controparteESocio}
                    onChange={e => setControparteESocio(e.target.checked)}
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <Label htmlFor="controparte_socio" className="font-normal cursor-pointer">La controparte è un socio / tesserato</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Incasso istituzionale (fuori campo IVA). Disabilita se il pagamento è commerciale.</p>
                  </div>
                </div>
              )}
              {/* Avvisa prima di pagare, non dopo: la ritenuta va trattenuta al momento del
                  pagamento, e accorgersene a versamento avvenuto significa doverla recuperare. */}
              {selectedCausale.tipo_controparte === "fornitore" && controparteId && (() => {
                const fornitore = suppliers.find(s => s.id === controparteId);
                if (!ritenutaDovuta(fornitore)) return null;
                const { ritenuta, netto, aliquota } = calcolaRitenuta(fornitore, Number(wData.importo) || 0, dettaglioFiscale("aliquota_ritenuta_acconto", wData.data)?.valore);
                return (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-sm">
                    <Receipt className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Pagamento soggetto a ritenuta d'acconto ({aliquota}%)</p>
                      <p className="text-xs mt-0.5">
                        Al fornitore vanno {formatEuro(netto)};
                        {formatEuro(ritenuta)} restano da versare all'erario.
                        La registrazione tiene il costo per intero e separa la ritenuta come debito
                        verso l'erario, da versare con l'F24.
                      </p>
                    </div>
                  </div>
                );
              })()}
              {/* Per un'entrata l'istituzionalità dipende da chi paga; per un costo dipende
                  da cosa serve, quindi va indicata a parte. Serve al report della gestione
                  istituzionale: senza, i costi non sarebbero attribuibili. */}
              {selectedCausale.tipo === "uscita" && (
                <div className="p-3 rounded-lg border border-border bg-muted/30">
                  <Label>A quale attività serve questo costo</Label>
                  <Select value={naturaCosto} onValueChange={setNaturaCosto}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="promiscua">Entrambe — costo promiscuo (affitto, utenze…)</SelectItem>
                      <SelectItem value="istituzionale">Solo attività istituzionale</SelectItem>
                      <SelectItem value="commerciale">Solo attività commerciale</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    I costi promiscui restano da ripartire: il report li tiene separati invece di attribuirli d'ufficio.
                  </p>
                </div>
              )}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setWizardStep(2)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
                <Button onClick={() => setWizardStep(4)}>Avanti <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </div>
          )}

          {/* Step 4: conferma */}
          {wizardStep === 4 && selectedCausale && (
            <div className="space-y-4">
              <div className="space-y-2 p-4 rounded-lg bg-muted/40 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Causale</span><span className="font-medium">{selectedCausale.nome_visibile}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Importo</span><span className="font-medium">{formatEuro(Number(wData.importo || 0))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Data</span><span className="font-medium">{formatData(wData.data)}</span></div>
                {selectedCausale.permette_a_credito && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Pagamento</span><span className="font-medium">{aCredito ? `A credito${dataScadenza ? " (scad. " + formatData(dataScadenza) + ")" : ""}` : "Subito"}</span></div>
                )}
                {!aCredito && <div className="flex justify-between"><span className="text-muted-foreground">Metodo</span><span className="font-medium">{wData.metodo_liquidita === "banca" ? "Banca" : "Contanti"}</span></div>}
                {selectedCausale.puo_essere_istituzionale && controparteId && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Natura fiscale</span><span className="font-medium">{controparteESocio ? "Istituzionale (no IVA)" : "Commerciale"}</span></div>
                )}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => selectedCausale.richiede_controparte ? setWizardStep(3) : setWizardStep(2)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
                <Button onClick={handleConfirm} disabled={saving}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> {saving ? "Registrazione..." : "Conferma movimento"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}