import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { shouldShowIva } from "@/lib/receiptEngine";
import PageHeader from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Save, Eye } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

export default function ReceiptTemplatePage() {
  const { organization, loading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [template, setTemplate] = useState(null);
  const [orgForm, setOrgForm] = useState({ ragione_sociale: "", piva_cf: "", indirizzo: "", logo_url: "" });
  const [tplForm, setTplForm] = useState({ nota_piede: "", colore_accento: "#1e40af", mostra_iva_override: null });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const templates = await api.entities.ReceiptTemplate.filter({ organization_id: organization.id });
    const t = templates[0] || await api.entities.ReceiptTemplate.create({ organization_id: organization.id });
    setTemplate(t);
    setOrgForm({
      ragione_sociale: organization.ragione_sociale || organization.nome || "",
      piva_cf: organization.piva_cf || "",
      indirizzo: organization.indirizzo || "",
      logo_url: organization.logo_url || "",
    });
    setTplForm({
      nota_piede: t.nota_piede || "",
      colore_accento: t.colore_accento || "#1e40af",
      mostra_iva_override: t.mostra_iva_override ?? null,
    });
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      setOrgForm(f => ({ ...f, logo_url: file_url }));
      toast({ title: "Logo caricato" });
    } catch (err) {
      toast({ title: "Errore upload", description: err.message, variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!organization || !template) return;
    setSaving(true);
    try {
      await Promise.all([
        api.entities.Organization.update(organization.id, {
          ragione_sociale: orgForm.ragione_sociale,
          piva_cf: orgForm.piva_cf,
          indirizzo: orgForm.indirizzo,
          logo_url: orgForm.logo_url,
        }),
        api.entities.ReceiptTemplate.update(template.id, {
          nota_piede: tplForm.nota_piede,
          colore_accento: tplForm.colore_accento,
          mostra_iva_override: tplForm.mostra_iva_override,
        }),
      ]);
      toast({ title: "Template salvato", description: "Le nuove ricevute useranno questa configurazione" });
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (orgLoading || !template) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  // Preview data
  const showIva = shouldShowIva({ ...organization, ...orgForm }, tplForm);
  const sampleReceipt = {
    numero_progressivo: 42,
    esercizio_fiscale: moment().year(),
    tipo_documento: showIva ? "ricevuta_fiscale" : "ricevuta_semplice",
    data_emissione: moment().format("YYYY-MM-DD"),
    importo_lordo: 60,
    imponibile: 49.18,
    iva: 10.82,
    aliquota_iva: 22,
    plan_name: "Abbonamento Mensile",
  };
  const accent = tplForm.colore_accento || "#1e40af";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Template ricevuta" description="Configura dati azienda e aspetto grafico delle ricevute PDF" />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-heading">Dati azienda (anagrafica ricevuta)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Ragione sociale</Label>
                <Input value={orgForm.ragione_sociale} onChange={e => setOrgForm({ ...orgForm, ragione_sociale: e.target.value })} placeholder="Es. ASD Grip Palestra" />
              </div>
              <div>
                <Label>P.IVA / Cod. Fiscale</Label>
                <Input value={orgForm.piva_cf} onChange={e => setOrgForm({ ...orgForm, piva_cf: e.target.value })} placeholder="Es. 01234567890" />
              </div>
              <div>
                <Label>Indirizzo</Label>
                <Input value={orgForm.indirizzo} onChange={e => setOrgForm({ ...orgForm, indirizzo: e.target.value })} placeholder="Via Roma 1, 00100 Roma" />
              </div>
              <div>
                <Label>Logo</Label>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-input bg-transparent text-sm hover:bg-accent">
                      <Upload className="w-4 h-4" /> Carica logo
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  {orgForm.logo_url && <img src={orgForm.logo_url} alt="logo" className="h-10 w-10 object-contain border rounded" />}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-heading">Aspetto grafico</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Nota a piè di pagina</Label>
                <Textarea value={tplForm.nota_piede} onChange={e => setTplForm({ ...tplForm, nota_piede: e.target.value })} placeholder="Es. Ringraziamo per la fiducia. Questa ricevuta non è un documento fiscale..." rows={3} />
              </div>
              <div>
                <Label>Colore accento</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={tplForm.colore_accento} onChange={e => setTplForm({ ...tplForm, colore_accento: e.target.value })} className="w-12 h-9 rounded border cursor-pointer" />
                  <Input value={tplForm.colore_accento} onChange={e => setTplForm({ ...tplForm, colore_accento: e.target.value })} className="w-32" />
                </div>
              </div>
              <div>
                <Label>Mostra dettaglio IVA</Label>
                <Select
                  value={tplForm.mostra_iva_override === null ? "auto" : String(tplForm.mostra_iva_override)}
                  onValueChange={v => setTplForm({ ...tplForm, mostra_iva_override: v === "auto" ? null : v === "true" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatico (da regime/IVA)</SelectItem>
                    <SelectItem value="true">Forza mostra IVA</SelectItem>
                    <SelectItem value="false">Forza nascondi IVA</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Attualmente: {showIva ? "IVA mostrata" : "IVA nascosta"} (regime: {organization?.regime_fiscale || "—"}, gestione IVA: {organization?.gestione_iva ? "sì" : "no"})
                </p>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">
                <Save className="w-4 h-4 mr-1" /> {saving ? "Salvataggio..." : "Salva configurazione"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-heading flex items-center gap-2"><Eye className="w-4 h-4" /> Anteprima ricevuta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden bg-white" style={{ aspectRatio: "1/1.414" }}>
              <div className="h-full flex flex-col text-[10px] sm:text-xs" style={{ fontFamily: "Helvetica, sans-serif" }}>
                {/* Header band */}
                <div className="px-5 py-3 text-white flex items-start justify-between" style={{ backgroundColor: accent, minHeight: "70px" }}>
                  {orgForm.logo_url ? (
                    <img src={orgForm.logo_url} alt="logo" className="h-10 w-10 object-contain bg-white/10 rounded p-0.5" />
                  ) : (
                    <div className="h-10 w-10 bg-white/20 rounded flex items-center justify-center text-white font-bold text-sm">LOGO</div>
                  )}
                  <div className="text-right">
                    <div className="font-bold text-sm">{orgForm.ragione_sociale || "Nome Azienda"}</div>
                    {orgForm.indirizzo && <div className="opacity-90">{orgForm.indirizzo}</div>}
                    {showIva && orgForm.piva_cf && <div className="opacity-90">P.IVA/C.F.: {orgForm.piva_cf}</div>}
                  </div>
                </div>
                {/* Title */}
                <div className="px-5 pt-4">
                  <div className="text-base font-bold text-gray-800">{sampleReceipt.tipo_documento === "ricevuta_semplice" ? "RICEVUTA" : "RICEVUTA FISCALE"}</div>
                  <div className="flex justify-between mt-1 text-gray-600">
                    <span>N. {sampleReceipt.numero_progressivo}/{sampleReceipt.esercizio_fiscale}</span>
                    <span>Data: {moment(sampleReceipt.data_emissione).format("DD/MM/YYYY")}</span>
                  </div>
                </div>
                {/* Cliente */}
                <div className="px-5 mt-4">
                  <div className="border-t pt-2" style={{ borderColor: accent }}>
                    <div className="font-bold text-gray-700">CLIENTE</div>
                    <div className="text-gray-600">Mario Rossi</div>
                  </div>
                </div>
                {/* Table */}
                <div className="px-5 mt-4">
                  <div className="bg-gray-100 flex justify-between py-1.5 px-2 font-bold text-gray-700">
                    <span>Descrizione</span><span>Importo</span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2">
                    <span>{sampleReceipt.plan_name}</span><span>€ {sampleReceipt.importo_lordo.toFixed(2)}</span>
                  </div>
                  {showIva && (
                    <>
                      <div className="flex justify-between px-2 text-gray-600"><span>Imponibile</span><span>€ {sampleReceipt.imponibile.toFixed(2)}</span></div>
                      <div className="flex justify-between px-2 text-gray-600"><span>IVA ({sampleReceipt.aliquota_iva}%)</span><span>€ {sampleReceipt.iva.toFixed(2)}</span></div>
                    </>
                  )}
                  <div className="border-t pt-1.5 mt-1 flex justify-between font-bold" style={{ borderColor: accent }}>
                    <span>TOTALE</span><span>€ {sampleReceipt.importo_lordo.toFixed(2)}</span>
                  </div>
                </div>
                {/* Footer */}
                {tplForm.nota_piede && (
                  <div className="mt-auto px-5 pb-4 pt-4 text-gray-500 text-[9px] sm:text-[10px] leading-snug">
                    {tplForm.nota_piede}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}