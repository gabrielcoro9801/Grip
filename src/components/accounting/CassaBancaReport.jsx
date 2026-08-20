import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Landmark, Info, Download } from "lucide-react";
import moment from "moment";

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Estratto conto di cassa e banca: mostra il saldo a una data e come ci si è arrivati.
 *
 * I totali aggregati di entrate e uscite dicono quanto si è incassato e speso, ma non
 * quanto c'è adesso: un incasso ancora da riscuotere non è denaro disponibile. Qui si
 * seguono solo i movimenti che toccano davvero la liquidità, in ordine di data, con il
 * saldo progressivo accanto a ciascuno.
 */
export default function CassaBancaReport({ entries, lines, accounts }) {
  // Nel piano dei conti predefinito la liquidità sta nel gruppo 2 (2.1 Cassa, 2.2 Banca).
  // Se l'ente aggiunge un altro conto liquido con quella numerazione, compare qui da solo.
  const contiLiquidi = useMemo(
    () => accounts.filter((a) => a.codice?.startsWith("2.")).sort((a, b) => a.codice.localeCompare(b.codice)),
    [accounts]
  );

  const annoCorrente = new Date().getFullYear();
  const [contoId, setContoId] = useState("");
  const [dateFrom, setDateFrom] = useState(`${annoCorrente}-01-01`);
  const [dateTo, setDateTo] = useState(`${annoCorrente}-12-31`);

  const contoSelezionato = contoId || contiLiquidi[0]?.id;

  const dati = useMemo(() => {
    const entryById = new Map(entries.filter((e) => e.stato === "confermata").map((e) => [e.id, e]));

    // La data che conta per la liquidità è quella in cui il denaro si muove, non quella di
    // competenza economica: un costo di marzo pagato ad aprile esce di cassa ad aprile.
    const dataMovimento = (e) => e.data_cassa || e.data_competenza;

    const movimentiConto = lines
      .filter((l) => l.conto_id === contoSelezionato && entryById.has(l.journal_entry_id))
      .map((l) => {
        const e = entryById.get(l.journal_entry_id);
        return {
          id: l.id,
          data: dataMovimento(e),
          descrizione: e.descrizione || e.causale || "—",
          entrata: Number(l.dare) || 0,
          uscita: Number(l.avere) || 0,
        };
      })
      .sort((a, b) => a.data.localeCompare(b.data));

    // Il saldo iniziale è tutto ciò che è avvenuto prima del periodo scelto: senza, il
    // saldo progressivo partirebbe da zero e non direbbe quanto c'è davvero.
    const saldoIniziale = movimentiConto
      .filter((m) => !dateFrom || m.data < dateFrom)
      .reduce((s, m) => s + m.entrata - m.uscita, 0);

    let progressivo = saldoIniziale;
    const righe = movimentiConto
      .filter((m) => (!dateFrom || m.data >= dateFrom) && (!dateTo || m.data <= dateTo))
      .map((m) => {
        progressivo += m.entrata - m.uscita;
        return { ...m, saldo: progressivo };
      });

    // Saldo di ciascun conto a fine periodo, per il riepilogo in alto.
    const saldiPerConto = contiLiquidi.map((c) => {
      const saldo = lines
        .filter((l) => l.conto_id === c.id && entryById.has(l.journal_entry_id))
        .filter((l) => !dateTo || dataMovimento(entryById.get(l.journal_entry_id)) <= dateTo)
        .reduce((s, l) => s + (Number(l.dare) || 0) - (Number(l.avere) || 0), 0);
      return { conto: c, saldo };
    });

    return {
      righe,
      saldoIniziale,
      saldoFinale: progressivo,
      totaleEntrate: righe.reduce((s, r) => s + r.entrata, 0),
      totaleUscite: righe.reduce((s, r) => s + r.uscita, 0),
      saldiPerConto,
    };
  }, [entries, lines, contoSelezionato, contiLiquidi, dateFrom, dateTo]);

  const esportaCsv = () => {
    const intestazione = "Data,Descrizione,Entrate,Uscite,Saldo\n";
    const corpo = dati.righe
      .map((r) => `${r.data},"${(r.descrizione || "").replace(/"/g, '""')}",${r.entrata.toFixed(2)},${r.uscita.toFixed(2)},${r.saldo.toFixed(2)}`)
      .join("\n");
    const conto = contiLiquidi.find((c) => c.id === contoSelezionato);
    const blob = new Blob([intestazione + corpo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estratto-conto-${conto?.codice || "liquidita"}-${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (contiLiquidi.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        Nessun conto di liquidità nel piano dei conti (attesi 2.1 Cassa e 2.2 Banca).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Saldi di tutti i conti liquidi alla data di fine periodo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dati.saldiPerConto.map(({ conto, saldo }) => (
          <Card key={conto.id} className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{conto.nome}</p>
                  <p className={`text-2xl font-bold ${saldo >= 0 ? "" : "text-red-500"}`}>€{fmt(saldo)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">al {moment(dateTo).format("DD/MM/YYYY")}</p>
                </div>
                <div className="bg-muted p-2 rounded-lg">
                  {conto.ruolo_sistema === "cassa" ? <Wallet className="w-5 h-5 text-muted-foreground" /> : <Landmark className="w-5 h-5 text-muted-foreground" />}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-52">
          <Label className="text-xs">Conto</Label>
          <Select value={contoSelezionato} onValueChange={setContoId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {contiLiquidi.map((c) => <SelectItem key={c.id} value={c.id}>{c.codice} — {c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Dal</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Al</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setDateFrom(`${annoCorrente}-01-01`); setDateTo(`${annoCorrente}-12-31`); }}>
          Esercizio {annoCorrente}
        </Button>
        <Button variant="outline" size="sm" onClick={esportaCsv} disabled={dati.righe.length === 0}>
          <Download className="w-4 h-4 mr-1" /> CSV
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left">
              <th className="py-2.5 px-4 font-medium text-muted-foreground whitespace-nowrap">Data</th>
              <th className="py-2.5 px-4 font-medium text-muted-foreground">Descrizione</th>
              <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Entrate</th>
              <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Uscite</th>
              <th className="py-2.5 px-4 font-medium text-muted-foreground text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/50 bg-muted/10">
              <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">{moment(dateFrom).format("DD/MM/YYYY")}</td>
              <td className="py-2.5 px-4 text-muted-foreground italic" colSpan={3}>Saldo iniziale</td>
              <td className="py-2.5 px-4 text-right font-medium">€{fmt(dati.saldoIniziale)}</td>
            </tr>
            {dati.righe.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Nessun movimento di liquidità nel periodo</td></tr>
            ) : dati.righe.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">{moment(r.data).format("DD/MM/YYYY")}</td>
                <td className="py-2.5 px-4">{r.descrizione}</td>
                <td className="py-2.5 px-4 text-right text-emerald-600">{r.entrata ? `€${fmt(r.entrata)}` : ""}</td>
                <td className="py-2.5 px-4 text-right text-red-500">{r.uscita ? `€${fmt(r.uscita)}` : ""}</td>
                <td className={`py-2.5 px-4 text-right font-medium ${r.saldo < 0 ? "text-red-500" : ""}`}>€{fmt(r.saldo)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="py-2.5 px-4 whitespace-nowrap">{moment(dateTo).format("DD/MM/YYYY")}</td>
              <td className="py-2.5 px-4">Saldo finale</td>
              <td className="py-2.5 px-4 text-right text-emerald-600">€{fmt(dati.totaleEntrate)}</td>
              <td className="py-2.5 px-4 text-right text-red-500">€{fmt(dati.totaleUscite)}</td>
              <td className={`py-2.5 px-4 text-right font-bold ${dati.saldoFinale < 0 ? "text-red-500" : ""}`}>€{fmt(dati.saldoFinale)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Compaiono solo i movimenti che toccano davvero la liquidità: un incasso ancora da
          riscuotere o una fattura non pagata non figurano qui, perché il denaro non si è
          mosso — li trovi in Scadenzario. La data usata è quella dell'effettivo movimento di
          cassa, non quella di competenza.
        </span>
      </div>
    </div>
  );
}
