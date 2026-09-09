import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/Spinner";
import { formatDataOra } from "@/lib/format";

const ACTION_LABELS = {
  create: "Creazione",
  update: "Modifica",
  delete: "Cancellazione",
  deactivate: "Disattivazione",
  activate: "Riattivazione",
  role_change: "Cambio ruolo",
  password_reset: "Reset password",
};

const ENTITY_LABELS = {
  finance_expense: "Spesa",
  finance_revenue: "Entrata",
  booking: "Prenotazione",
  course: "Corso",
  member: "Cliente",
  staff_account: "Account staff",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState("tutti");
  const [filterAction, setFilterAction] = useState("tutte");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    api.entities.AuditLog.list("-timestamp", 200).then(l => { setLogs(l); setLoading(false); });
  }, []);

  const uniqueUsers = useMemo(() => {
    const users = new Map();
    logs.forEach(l => { if (l.attore_nome) users.set(l.attore_id || l.attore_nome, l.attore_nome); });
    return Array.from(users.entries());
  }, [logs]);

  const filtered = useMemo(() => {
    return logs
      .filter(l => filterUser === "tutti" || l.attore_id === filterUser || l.attore_nome === filterUser)
      .filter(l => filterAction === "tutte" || l.tipo_azione === filterAction)
      .filter(l => !dateFrom || (l.timestamp && l.timestamp >= dateFrom))
      .filter(l => !dateTo || (l.timestamp && l.timestamp <= dateTo + "T23:59:59"));
  }, [logs, filterUser, filterAction, dateFrom, dateTo]);

  if (loading) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Log audit" description="Registro delle azioni sensibili: chi ha fatto cosa, e quando" />

      {/* Filtri */}
      <div className="flex flex-wrap gap-3">
        <div>
          <Label className="text-xs">Utente</Label>
          <Select value={filterUser} onValueChange={setFilterUser}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti</SelectItem>
              {uniqueUsers.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo azione</Label>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tutte">Tutte</SelectItem>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Dal</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Al</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* Tabella */}
      <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-muted/30">
              <th className="py-3 px-4 font-medium text-muted-foreground">Data e ora</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Utente</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Azione</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Entità</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">Dettagli</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Nessuna voce di log trovata</td></tr>
            ) : filtered.map(log => (
              <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                  {formatDataOra(log.timestamp)}
                </td>
                <td className="py-3 px-4 font-medium">{log.attore_nome}</td>
                <td className="py-3 px-4">
                  <Badge variant="outline" className="text-xs">
                    {ACTION_LABELS[log.tipo_azione] || log.tipo_azione}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  <div className="text-xs text-muted-foreground">{ENTITY_LABELS[log.entita_tipo] || log.entita_tipo}</div>
                  {log.entita_nome && <div className="text-sm font-medium">{log.entita_nome}</div>}
                </td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{log.dettagli || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} voci trovate</p>
    </div>
  );
}