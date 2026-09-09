import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logAction } from "@/lib/auditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, LogIn, LogOut, Pencil } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { puo } from "@/lib/permissions";
import { LoadingState } from "@/components/shared/Spinner";
import { formatDataOra, formatOra } from "@/lib/format";

export default function TimbraturaPage() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  // Chi gestisce il personale vede i dati di tutti; un dipendente vede i propri.
  const gestisceTutti = puo(staffUser?.ruolo, "gestire_personale");
  const empId = staffUser?.linked_collaboratore_id;
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [timbrature, setTimbrature] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterEmp, setFilterEmp] = useState("all");
  const [editTarget, setEditTarget] = useState(null);
  const [editValue, setEditValue] = useState("");

  const loadData = async () => {
    if (gestisceTutti) {
      if (!organization?.id) return;
      const [tims, emps] = await Promise.all([
        api.entities.Timbratura.list("-data_ora_server", 200),
        api.entities.Collaboratore.filter({ organization_id: organization.id, tipo_rapporto: "dipendente" }),
      ]);
      setTimbrature(tims);
      setEmployees(emps);
    } else if (empId) {
      const tims = await api.entities.Timbratura.filter({ dipendente_id: empId }, "-data_ora_server", 200);
      setTimbrature(tims);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [organization]);

  const lastTimbratura = timbrature[0];
  const nextTipo = lastTimbratura?.tipo === "entrata" ? "uscita" : "entrata";
  const isClockedIn = lastTimbratura?.tipo === "entrata";

  const handleTimbra = async () => {
    const emp = employees.find((e) => e.id === empId);
    await api.entities.Timbratura.create({
      dipendente_id: empId,
      dipendente_nome: emp ? `${emp.nome} ${emp.cognome}` : staffUser.nome,
      tipo: nextTipo,
      data_ora_server: new Date().toISOString(),
    });
    toast({ title: nextTipo === "entrata" ? "Entrata registrata" : "Uscita registrata", description: formatDataOra(moment()) });
    loadData();
  };

  const handleCorrect = async () => {
    if (!editTarget) return;
    const oldValue = editTarget.data_ora_server;
    const newValue = moment(editValue).toISOString();
    await api.entities.Timbratura.update(editTarget.id, {
      data_ora_server: newValue,
      corretta_da: staffUser.nome,
      corretta_il: new Date().toISOString(),
    });
    await logAction(
      staffUser, "update", "timbratura", editTarget.dipendente_nome, editTarget.id,
      `Correzione timbratura ${editTarget.tipo}`,
      formatDataOra(oldValue),
      formatDataOra(newValue)
    );
    toast({ title: "Timbratura corretta" });
    setEditTarget(null);
    loadData();
  };

  const filtered = gestisceTutti && filterEmp !== "all" ? timbrature.filter((t) => t.dipendente_id === filterEmp) : timbrature;

  if (loading) return <LoadingState minHeight="h-64" />;

  if (!gestisceTutti && !empId) {
    return <p className="text-sm text-muted-foreground">Profilo non collegato a un dipendente.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Timbratura</h1>

      {!gestisceTutti && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isClockedIn ? "bg-emerald-100" : "bg-muted"}`}>
              <Clock className={`w-10 h-10 ${isClockedIn ? "text-emerald-600" : "text-muted-foreground"}`} />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">{isClockedIn ? "Sei in servizio dalle" : "Non hai timbrato l'entrata"}</p>
              {isClockedIn && <p className="text-lg font-bold">{formatOra(lastTimbratura.data_ora_server)}</p>}
            </div>
            <Button size="lg" className="w-full max-w-xs" onClick={handleTimbra}>
              {nextTipo === "entrata" ? <><LogIn className="w-5 h-5 mr-2" /> Timbra Entrata</> : <><LogOut className="w-5 h-5 mr-2" /> Timbra Uscita</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {gestisceTutti && (
        <div className="flex items-center gap-3">
          <Select value={filterEmp} onValueChange={setFilterEmp}>
            <SelectTrigger className="w-60"><SelectValue placeholder="Tutti i dipendenti" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i dipendenti</SelectItem>
              {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome} {e.cognome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30">
                  <th className="py-3 px-4 font-medium text-muted-foreground">Dipendente</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Tipo</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Data/Ora</th>
                  {gestisceTutti && <th className="py-3 px-4 font-medium text-muted-foreground text-right">Azioni</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium">{t.dipendente_nome}</td>
                    <td className="py-3 px-4">
                      <Badge variant={t.tipo === "entrata" ? "default" : "secondary"}>{t.tipo === "entrata" ? "Entrata" : "Uscita"}</Badge>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {formatDataOra(t.data_ora_server, { secondi: true })}
                      {t.corretta_da && <span className="block text-xs text-amber-600">Corretta da {t.corretta_da}</span>}
                    </td>
                    {gestisceTutti && (
                      <td className="py-3 px-4 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditTarget(t); setEditValue(moment(t.data_ora_server).format("YYYY-MM-DDTHH:mm")); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessuna timbratura.</p>}
        </CardContent>
      </Card>

      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Correggi timbratura</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Dipendente: <strong>{editTarget?.dipendente_nome}</strong></p>
            <div>
              <Label>Nuova data/ora</Label>
              <Input type="datetime-local" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
            </div>
            <p className="text-xs text-amber-600">La correzione sarà tracciata nel log di audit.</p>
            <Button className="w-full" onClick={handleCorrect}>Salva correzione</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}