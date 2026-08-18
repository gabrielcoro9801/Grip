import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, FileSpreadsheet } from "lucide-react";
import moment from "moment";
import {
  calcOreMese, calcStraordinari, countFerieGiorni, countPermessoOre,
  generaCSVPresenze, downloadCSV,
} from "@/lib/presenzeUtils";

const MESI = moment.months();

export default function PresenzeExportPage() {
  const { staffUser } = useStaffAuth();
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [timbrature, setTimbrature] = useState([]);
  const [richieste, setRichieste] = useState([]);
  const [mese, setMese] = useState(moment().month());
  const [anno, setAnno] = useState(moment().year());
  const [filterEmp, setFilterEmp] = useState("all");

  useEffect(() => {
    if (!organization?.id) return;
    Promise.all([
      api.entities.Collaboratore.filter({ organization_id: organization.id, tipo_rapporto: "dipendente" }),
      api.entities.Timbratura.list("-data_ora_server", 500),
      api.entities.RichiestaFeriePermesso.list("-created_date", 500),
    ]).then(([emps, tims, rich]) => {
      setEmployees(emps); setTimbrature(tims); setRichieste(rich); setLoading(false);
    });
  }, [organization]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const generaRiga = (emp) => {
    const empTims = timbrature.filter((t) => t.dipendente_id === emp.id);
    const empRich = richieste.filter((r) => r.dipendente_id === emp.id);
    return {
      dipendente: `${emp.nome} ${emp.cognome}`,
      mese: moment().year(anno).month(mese).format("MMMM YYYY"),
      oreLavorate: calcOreMese(empTims, anno, mese),
      straordinari: calcStraordinari(empTims, emp.soglia_settimanale_ore || 40, anno, mese),
      ferieGiorni: countFerieGiorni(empRich, anno, mese),
      permessoOre: countPermessoOre(empRich, anno, mese),
    };
  };

  const selectedEmployees = filterEmp === "all" ? employees : employees.filter((e) => e.id === filterEmp);
  const righe = selectedEmployees.map(generaRiga);

  const handleExport = () => {
    const csv = generaCSVPresenze(righe);
    downloadCSV(csv, `presenze_${anno}_${String(mese + 1).padStart(2, "0")}.csv`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Export Presenze</h1>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Mese</Label>
              <Select value={String(mese)} onValueChange={(v) => setMese(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESI.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Anno</Label>
              <Select value={String(anno)} onValueChange={(v) => setAnno(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[anno - 1, anno, anno + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dipendente</Label>
              <Select value={filterEmp} onValueChange={setFilterEmp}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.cognome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExport} disabled={righe.length === 0}>
              <Download className="w-4 h-4 mr-2" /> Esporta CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Dipendente</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Ore Lavorate</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Straordinari</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Ferie (gg)</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground text-right">Permessi (h)</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium">{r.dipendente}</td>
                    <td className="py-3 px-4 text-right">{r.oreLavorate.toFixed(1)}h</td>
                    <td className="py-3 px-4 text-right text-amber-600">{r.straordinari > 0 ? `+${r.straordinari.toFixed(1)}h` : "—"}</td>
                    <td className="py-3 px-4 text-right">{r.ferieGiorni || "—"}</td>
                    <td className="py-3 px-4 text-right">{r.permessoOre > 0 ? `${r.permessoOre.toFixed(1)}h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {righe.length === 0 && (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <FileSpreadsheet className="w-10 h-10 mb-2" />
              <p className="text-sm">Nessun dato per il periodo selezionato.</p>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Il formato CSV può essere concordato con il consulente del lavoro. Le colonne attuali: Dipendente, Mese, Ore Lavorate, Straordinari, Ferie, Permessi.
      </p>
    </div>
  );
}