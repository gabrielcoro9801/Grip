import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/shared/PageHeader";
import { Plus, Trash2 } from "lucide-react";

const TIPO_ORIGINE = [
  "manuale", "incasso_cliente", "fattura_fornitore", "pagamento_fornitore",
  "cespite_acquisto", "ammortamento", "prestito_erogazione", "rata_prestito", "utenza",
  "cespite_vendita",
];

const emptyLine = () => ({ conto_id: "", dare: "", avere: "", note: "" });

export default function NewJournalEntry() {
  const { organization, loading: orgLoading } = useOrganization();
  const [accounts, setAccounts] = useState([]);
  const [header, setHeader] = useState({
    data_competenza: new Date().toISOString().split("T")[0],
    data_cassa: "",
    descrizione: "",
    causale: "",
    tipo_origine: "manuale",
    riferimento_documento: "",
  });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (organization) {
      api.entities.ChartOfAccount.filter({ organization_id: organization.id, attivo: true }, "codice").then(setAccounts);
    }
  }, [organization]);

  const totDare = lines.reduce((s, l) => s + (Number(l.dare) || 0), 0);
  const totAvere = lines.reduce((s, l) => s + (Number(l.avere) || 0), 0);
  const differenza = Math.round((totDare - totAvere) * 100) / 100;

  const updateLine = (idx, field, value) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    setLines(next);
  };

  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const validateLines = () => {
    for (const l of lines) {
      if (!l.conto_id) return "Ogni riga deve avere un conto selezionato.";
      const d = Number(l.dare) || 0;
      const a = Number(l.avere) || 0;
      if (d !== 0 && a !== 0) return "Una riga non può avere sia Dare che Avere valorizzati.";
      if (d === 0 && a === 0) return "Ogni riga deve avere un importo in Dare o in Avere.";
    }
    return null;
  };

  const handleSave = async (stato) => {
    setError("");
    setSuccess("");
    const lineError = validateLines();
    if (lineError) { setError(lineError); return; }

    if (stato === "confermata" && differenza !== 0) {
      setError(`Le righe non quadrano: differenza di €${Math.abs(differenza).toFixed(2)} tra Dare e Avere.`);
      return;
    }

    setSaving(true);
    const existingEntries = await api.entities.JournalEntry.filter({ organization_id: organization.id }, "-numero_protocollo", 1);
    const numero_protocollo = (existingEntries[0]?.numero_protocollo || 0) + 1;

    const entry = await api.entities.JournalEntry.create({
      ...header,
      organization_id: organization.id,
      numero_protocollo,
      data_cassa: header.data_cassa || undefined,
      stato,
    });

    await api.entities.JournalLine.bulkCreate(
      lines.map(l => ({
        journal_entry_id: entry.id,
        conto_id: l.conto_id,
        dare: Number(l.dare) || 0,
        avere: Number(l.avere) || 0,
        note: l.note || undefined,
      }))
    );

    setSuccess(stato === "confermata" ? "Registrazione confermata con successo." : "Registrazione salvata come bozza.");
    setHeader({
      data_competenza: new Date().toISOString().split("T")[0],
      data_cassa: "",
      descrizione: "",
      causale: "",
      tipo_origine: "manuale",
      riferimento_documento: "",
    });
    setLines([emptyLine(), emptyLine()]);
    setSaving(false);
  };

  if (orgLoading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Nuova registrazione manuale" description="Crea una scrittura contabile con righe Dare/Avere bilanciate" />

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Data competenza *</Label><Input type="date" required value={header.data_competenza} onChange={e => setHeader({...header, data_competenza: e.target.value})} /></div>
            <div><Label>Data cassa</Label><Input type="date" value={header.data_cassa} onChange={e => setHeader({...header, data_cassa: e.target.value})} /></div>
          </div>
          <div><Label>Descrizione</Label><Input value={header.descrizione} onChange={e => setHeader({...header, descrizione: e.target.value})} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Causale</Label><Input value={header.causale} onChange={e => setHeader({...header, causale: e.target.value})} /></div>
            <div><Label>Riferimento documento</Label><Input value={header.riferimento_documento} onChange={e => setHeader({...header, riferimento_documento: e.target.value})} /></div>
          </div>
          <div>
            <Label>Tipo origine</Label>
            <Select value={header.tipo_origine} onValueChange={v => setHeader({...header, tipo_origine: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPO_ORIGINE.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm">Righe Dare / Avere</h3>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4 mr-1" /> Riga</Button>
          </div>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center p-2 rounded-lg bg-muted/40">
                <div className="flex-1 w-full">
                  <Select value={line.conto_id} onValueChange={v => updateLine(idx, "conto_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Seleziona conto" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" placeholder="Dare" className="w-full sm:w-28" value={line.dare} onChange={e => updateLine(idx, "dare", e.target.value)} />
                <Input type="number" placeholder="Avere" className="w-full sm:w-28" value={line.avere} onChange={e => updateLine(idx, "avere", e.target.value)} />
                <Input placeholder="Note" className="w-full sm:w-36" value={line.note} onChange={e => updateLine(idx, "note", e.target.value)} />
                <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-6 pt-3 border-t border-border text-sm">
            <span>Totale Dare: <strong>€{totDare.toFixed(2)}</strong></span>
            <span>Totale Avere: <strong>€{totAvere.toFixed(2)}</strong></span>
            <span className={differenza === 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
              {differenza === 0 ? "Quadrato" : `Differenza: €${Math.abs(differenza).toFixed(2)}`}
            </span>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      {success && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">{success}</p>}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => handleSave("bozza")} disabled={saving}>Salva bozza</Button>
        <Button onClick={() => handleSave("confermata")} disabled={saving || differenza !== 0}>Conferma registrazione</Button>
      </div>
    </div>
  );
}