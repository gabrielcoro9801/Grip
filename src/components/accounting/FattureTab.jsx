import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Download, FileText, AlertTriangle, FileCode2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 });

/**
 * Elenco delle fatture emesse verso clienti terzi.
 * Le fatture nascono automaticamente registrando un incasso da un cliente di tipo azienda:
 * non c'è un pulsante per crearle a mano, perché una fattura senza il movimento che la
 * origina sarebbe un documento scollegato dalla contabilità.
 */
export default function FattureTab({ organization }) {
  const annoCorrente = new Date().getFullYear();
  const { toast } = useToast();
  const [fatture, setFatture] = useState([]);
  const [loading, setLoading] = useState(true);
  const [esercizio, setEsercizio] = useState(annoCorrente);
  const [scaricando, setScaricando] = useState(null);

  // Il file lo costruisce il server dai dati anagrafici correnti; qui si consegna al
  // browser. Se manca qualcosa il server risponde con l'elenco puntuale dei campi, che
  // viene mostrato: sapere *cosa* aprire è la differenza fra correggerlo e cercarlo.
  const scaricaXml = async (fattura) => {
    setScaricando(fattura.id);
    try {
      const { xml, nome } = await api.accounting.downloadInvoiceXml(fattura.id);
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Fattura elettronica non generabile",
        description: err.mancanti?.length ? err.mancanti.join(" · ") : err.message,
        variant: "destructive",
      });
    }
    setScaricando(null);
  };

  const loadData = useCallback(async () => {
    if (!organization) return;
    const f = await api.entities.Invoice.filter(
      { organization_id: organization.id, esercizio_fiscale: esercizio },
      "-numero_progressivo",
    );
    setFatture(f);
    setLoading(false);
  }, [organization, esercizio]);

  useEffect(() => { loadData(); }, [loadData]);

  const totaleImponibile = fatture.reduce((s, f) => s + Number(f.imponibile || 0), 0);
  const totaleIva = fatture.reduce((s, f) => s + Number(f.iva || 0), 0);

  // Una numerazione con salti è il primo elemento che un controllo verifica: se manca un
  // numero significa che una fattura è stata eliminata o mai emessa, e va spiegato.
  const numeri = fatture.map((f) => f.numero_progressivo).sort((a, b) => a - b);
  const mancanti = numeri.length > 0
    ? Array.from({ length: numeri[numeri.length - 1] }, (_, i) => i + 1).filter((n) => !numeri.includes(n))
    : [];

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-32">
          <Label className="text-xs">Esercizio</Label>
          <Input type="number" value={esercizio} onChange={(e) => setEsercizio(Number(e.target.value))} />
        </div>
        {fatture.length > 0 && (
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Imponibile</p>
              <p className="font-bold">€{fmt(totaleImponibile)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">IVA</p>
              <p className="font-bold">€{fmt(totaleIva)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fatture</p>
              <p className="font-bold">{fatture.length}</p>
            </div>
          </div>
        )}
      </div>

      {mancanti.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Numerazione con salti: mancano le fatture {mancanti.join(", ")}. Una numerazione
            non continua va spiegata in sede di controllo.
          </span>
        </div>
      )}

      {fatture.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center space-y-2">
            <FileText className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nessuna fattura emessa nell'esercizio {esercizio}.</p>
            <p className="text-xs text-muted-foreground">
              Le fatture si generano da sole registrando un incasso da un cliente di tipo azienda
              (per esempio l'affitto di una sala): a un privato viene emessa una ricevuta.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="py-2.5 px-4 font-medium text-muted-foreground">N.</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Data</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Cliente</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground">Descrizione</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Imponibile</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">IVA</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Totale</th>
                <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Documenti</th>
              </tr>
            </thead>
            <tbody>
              {fatture.map((f) => (
                <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-2.5 px-4 font-medium whitespace-nowrap">{f.numero_progressivo}/{f.esercizio_fiscale}</td>
                  <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">{moment(f.data_emissione).format("DD/MM/YYYY")}</td>
                  <td className="py-2.5 px-4">
                    {f.cliente_name}
                    {f.cliente_piva && <span className="block text-xs text-muted-foreground">{f.cliente_piva}</span>}
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">{f.descrizione || "—"}</td>
                  <td className="py-2.5 px-4 text-right">€{fmt(f.imponibile)}</td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground">€{fmt(f.iva)}</td>
                  <td className="py-2.5 px-4 text-right font-medium">€{fmt(f.totale)}</td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1">
                      {f.pdf_url ? (
                        <a href={f.pdf_url} target="_blank" rel="noopener noreferrer" title="Scarica il PDF di cortesia">
                          <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="w-3.5 h-3.5" /></Button>
                        </a>
                      ) : (
                        <Badge variant="outline" className="text-xs">senza PDF</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={scaricando === f.id}
                        onClick={() => scaricaXml(f)}
                        title="Scarica il file XML da trasmettere allo SdI"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        {scaricando === f.id ? "…" : "XML"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50/60 border border-amber-200 text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Il PDF è un <strong>documento di cortesia</strong> e non sostituisce la fattura: verso un
          soggetto con partita IVA la fattura è il file <strong>XML</strong>. L'applicazione lo
          genera, ma <strong>non lo trasmette</strong>: scaricalo e invialo allo SdI tu o il tuo
          commercialista, dal portale Fatture e Corrispettivi o dal canale che già usate. Resta a
          vostro carico anche la conservazione a norma per dieci anni, che è un obbligo distinto
          dall'invio.
        </span>
      </div>
    </div>
  );
}
