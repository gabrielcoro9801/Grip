import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, FileCheck2, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import IndirizzoFatturazione from "@/components/shared/IndirizzoFatturazione";
import { REGIMI_FISCALI, datiMancantiEmittente } from "../../../shared/fatturaElettronica.js";

const CAMPI = [
  "partita_iva",
  "codice_fiscale",
  "regime_fiscale_codice",
  "indirizzo_via",
  "indirizzo_civico",
  "indirizzo_cap",
  "indirizzo_comune",
  "indirizzo_provincia",
];

/**
 * Dati dell'associazione richiesti dalla fattura elettronica.
 *
 * Sono separati da quelli che compaiono sulle ricevute (Template ricevuta) perché lì basta
 * una riga di testo e un identificativo qualsiasi, mentre qui il tracciato dello SdI
 * distingue partita IVA e codice fiscale — per un'ASD sono due numeri diversi — e vuole la
 * sede scomposta. Compilarli male non dà errore subito: la fattura viene scartata dopo.
 */
export default function DatiFatturazione({ organization, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organization) return;
    const iniziale = {};
    for (const campo of CAMPI) iniziale[campo] = organization[campo] || "";
    // La ragione sociale vive già altrove: qui si mostra solo per far vedere cosa finirà
    // sulla fattura, e si compila da "Template ricevuta".
    setForm(iniziale);
  }, [organization]);

  // La stessa verifica che il server applica prima di costruire l'XML, così i campi da
  // completare si vedono subito invece di scoprirli al momento di emettere.
  const mancanti = datiMancantiEmittente({ ...organization, ...form });

  const salva = async () => {
    setSaving(true);
    try {
      await api.entities.Organization.update(organization.id, form);
      toast({ title: "Dati di fatturazione salvati" });
      onSaved?.();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (!organization) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-heading flex items-center gap-2">
          <FileCheck2 className="w-4 h-4" /> Dati per la fattura elettronica
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Servono per il file XML da trasmettere allo SdI. Il PDF che l'app genera oggi è un
          documento di cortesia: verso un cliente con partita IVA non sostituisce la fattura
          elettronica.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Partita IVA</Label>
            <Input
              value={form.partita_iva || ""}
              onChange={(e) => setForm({ ...form, partita_iva: e.target.value.replace(/\s/g, "") })}
              placeholder="01234567891"
              maxLength={16}
            />
          </div>
          <div>
            <Label>Codice fiscale</Label>
            <Input
              value={form.codice_fiscale || ""}
              onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value.replace(/\s/g, "").toUpperCase() })}
              placeholder="98765432101"
              maxLength={16}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Per un'associazione sono quasi sempre due numeri diversi: il tracciato li vuole distinti.
        </p>

        <div>
          <Label>Regime fiscale</Label>
          <Select
            value={form.regime_fiscale_codice || ""}
            onValueChange={(v) => setForm({ ...form, regime_fiscale_codice: v })}
          >
            <SelectTrigger><SelectValue placeholder="Seleziona il codice del tracciato" /></SelectTrigger>
            <SelectContent>
              {Object.entries(REGIMI_FISCALI).map(([codice, descrizione]) => (
                <SelectItem key={codice} value={codice}>{codice} — {descrizione}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Per la L. 398/1991 il tracciato non ha un codice dedicato e si usa <strong>RF18 (Altro)</strong>.
            Fallo confermare al tuo commercialista: qui l'app non sceglie al posto tuo.
          </p>
        </div>

        <div>
          <Label className="mb-2 block">Sede legale</Label>
          <IndirizzoFatturazione valori={form} onChange={setForm} />
        </div>

        {mancanti.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Con questi dati non si può ancora emettere una fattura elettronica.</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {mancanti.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          </div>
        )}

        <Button onClick={salva} disabled={saving} size="sm">
          <Save className="w-4 h-4 mr-1" /> {saving ? "Salvataggio…" : "Salva dati di fatturazione"}
        </Button>
      </CardContent>
    </Card>
  );
}
