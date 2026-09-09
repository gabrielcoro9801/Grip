import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { trovaContoPerRuolo } from "../../../shared/contiSistema.js";
import { formatEuro, formatNumero } from "@/lib/format";

export default function IvaReport({ entries, lines, accounts }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const contoIVADebito = useMemo(
    () => trovaContoPerRuolo(accounts, "iva_debito"),
    [accounts]
  );

  const totaleIVACommerciale = useMemo(() => {
    if (!contoIVADebito) return 0;
    const commercialEntryIds = new Set(
      entries
        .filter(e => e.natura_fiscale === "commerciale")
        .filter(e => !dateFrom || e.data_competenza >= dateFrom)
        .filter(e => !dateTo || e.data_competenza <= dateTo)
        .map(e => e.id)
    );
    return lines
      .filter(l => l.conto_id === contoIVADebito.id)
      .filter(l => commercialEntryIds.has(l.journal_entry_id))
      .reduce((s, l) => s + (l.avere || 0), 0);
  }, [entries, lines, contoIVADebito, dateFrom, dateTo]);

  const stimaDaVersare = totaleIVACommerciale * 0.5;


  return (
    <div className="space-y-6">
      {/* Selettore periodo */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs">Dal</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Al</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        {(dateFrom || dateTo) && <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Pulisci</Button>}
      </div>

      {/* Banner informativo */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50">
        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">
          Stima indicativa calcolata al 50% dell'IVA incassata su proventi commerciali (art. 74 c.6 DPR 633/72, aliquota generale). Non considera l'eventuale aliquota ridotta 2/3 per cessione di diritti radiotelevisivi. Verificare sempre con il commercialista prima del versamento.
        </p>
      </div>

      {/* Riepilogo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Totale IVA incassata (commerciale)</p>
            <p className="text-2xl font-bold mt-1">{formatEuro(totaleIVACommerciale)}</p>
            <p className="text-xs text-muted-foreground mt-1">Somma dell'IVA a debito (conto 4.3) su movimenti commerciali nel periodo</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-primary/5">
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stima IVA da versare</p>
            <p className="text-2xl font-bold text-primary mt-1">{formatEuro(stimaDaVersare)}</p>
            <p className="text-xs text-muted-foreground mt-1">50% del totale IVA incassata su proventi commerciali</p>
          </CardContent>
        </Card>
      </div>

      {!contoIVADebito && (
        <p className="text-sm text-muted-foreground">Conto 4.3 (IVA a debito) non trovato nel piano dei conti. Impossibile calcolare il totale.</p>
      )}
    </div>
  );
}
