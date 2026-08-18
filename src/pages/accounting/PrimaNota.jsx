import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useOrganization } from "@/hooks/useOrganization";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import moment from "moment";

export default function PrimaNota() {
  const { organization, loading: orgLoading } = useOrganization();
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterConto, setFilterConto] = useState("tutti");

  useEffect(() => {
    if (!organization) return;
    Promise.all([
      base44.entities.JournalEntry.filter({ organization_id: organization.id, stato: "confermata" }, "-data_competenza"),
      base44.entities.ChartOfAccount.filter({ organization_id: organization.id }),
    ]).then(async ([e, acc]) => {
      const entryIds = e.map(x => x.id);
      let allLines = [];
      if (entryIds.length > 0) {
        allLines = await base44.entities.JournalLine.filter({});
        allLines = allLines.filter(l => entryIds.includes(l.journal_entry_id));
      }
      setEntries(e);
      setLines(allLines);
      setAccounts(acc);
      setLoading(false);
    });
  }, [organization]);

  const accountName = (id) => {
    const a = accounts.find(a => a.id === id);
    return a ? `${a.codice} ${a.nome}` : "—";
  };

  const rows = useMemo(() => {
    return entries
      .filter(e => !dateFrom || e.data_competenza >= dateFrom)
      .filter(e => !dateTo || e.data_competenza <= dateTo)
      .map(e => {
        const entryLines = lines.filter(l => l.journal_entry_id === e.id);
        return { entry: e, lines: entryLines };
      })
      .filter(r => filterConto === "tutti" || r.lines.some(l => l.conto_id === filterConto));
  }, [entries, lines, dateFrom, dateTo, filterConto]);

  if (orgLoading || loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <div>
          <Label className="text-xs">Dal</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Al</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Conto</Label>
          <Select value={filterConto} onValueChange={setFilterConto}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti i conti</SelectItem>
              {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.codice} — {a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Data</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Descrizione</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Conti movimentati</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Dare</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">Avere</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Nessuna registrazione trovata</td></tr>
            ) : rows.map(({ entry, lines: entryLines }) => {
              const totDare = entryLines.reduce((s, l) => s + (l.dare || 0), 0);
              const totAvere = entryLines.reduce((s, l) => s + (l.avere || 0), 0);
              return (
                <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30 align-top">
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{moment(entry.data_competenza).format("DD/MM/YYYY")}</td>
                  <td className="py-3 px-4">{entry.descrizione || entry.causale || "—"}</td>
                  <td className="py-3 px-4">
                    {entryLines.map(l => (
                      <div key={l.id} className="text-xs text-muted-foreground">{accountName(l.conto_id)}</div>
                    ))}
                  </td>
                  <td className="py-3 px-4 text-right font-medium">€{totDare.toFixed(2)}</td>
                  <td className="py-3 px-4 text-right font-medium">€{totAvere.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}