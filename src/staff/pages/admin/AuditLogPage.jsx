import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/core/api/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Badge } from "@/ui/primitivi/badge";
import PageHeader from "@/staff/components/PageHeader";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { Button } from "@/ui/primitivi/button";
import { formatDataOra } from "@/core/domain/format";

// Quante voci per volta: abbastanza per una giornata di lavoro, poche per aprire la pagina.
const PAGINA = 100;

const ACTION_LABELS = {
  create: "Creazione",
  update: "Modifica",
  delete: "Cancellazione",
  deactivate: "Disattivazione",
  activate: "Riattivazione",
  role_change: "Cambio ruolo",
  password_reset: "Reset password",
  password_change: "Cambio password",
};

// I tipi li scrive il server (server/src/lib/registro.js), dal nome dell'entità. Le voci
// della contabilità sono sparite con la contabilità.
const ENTITY_LABELS = {
  member: "Socio",
  subscription: "Iscrizione",
  plan: "Abbonamento",
  member_document: "Documento",
  qraccesso: "Codice d'accesso",
  lead: "Contatto",
  canale_contatto: "Canale",
  course: "Corso",
  category: "Categoria",
  instructor: "Istruttore",
  event: "Evento",
  session: "Lezione",
  room: "Sala",
  booking: "Prenotazione",
  // I collaboratori non esistono più, ma il registro tiene le azioni fatte quando c'erano.
  collaboratore: "Collaboratore",
  staff_account: "Account",
  exercise: "Esercizio",
  exercise_plan: "Scheda",
  organization: "Ente",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState("tutti");
  const [filterAction, setFilterAction] = useState("tutte");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [altre, setAltre] = useState(false);
  const [caricandoAltre, setCaricandoAltre] = useState(false);
  const [errore, setErrore] = useState(null);

  // Una pagina alla volta, dalla più recente. Prima erano le ultime 200 righe e basta: tutto
  // quello che c'era prima non si poteva più vedere dalla schermata. "Carica altre" riparte
  // dall'orario dell'ultima voce mostrata; le voci con lo stesso orario si scartano per id.
  const caricaPagina = useCallback(async (prima) => {
    const filtro = prima ? { timestamp__lte: prima } : {};
    const pagina = await api.entities.AuditLog.filter(filtro, "-timestamp", PAGINA + 1);
    setAltre(pagina.length > PAGINA);
    return pagina.slice(0, PAGINA);
  }, []);

  useEffect(() => {
    caricaPagina(null).then(setLogs).catch(setErrore).finally(() => setLoading(false));
  }, [caricaPagina]);

  const caricaAltre = async () => {
    setCaricandoAltre(true);
    try {
      // Un millisecondo in più: il database tiene i microsecondi, il JSON i millisecondi, e
      // ripartire dall'orario troncato perderebbe le voci dello stesso millisecondo. I doppioni
      // che ne vengono si scartano qui sotto.
      const ultimo = logs[logs.length - 1]?.timestamp;
      const pagina = await caricaPagina(ultimo ? new Date(Date.parse(ultimo) + 1).toISOString() : null);
      setLogs((gia) => {
        const visti = new Set(gia.map((l) => l.id));
        return [...gia, ...pagina.filter((l) => !visti.has(l.id))];
      });
    } catch (err) {
      setErrore(err);
    }
    setCaricandoAltre(false);
  };

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
  if (errore && !logs.length) return <ErrorState error={errore} onRetry={() => window.location.reload()} />;

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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {filtered.length} voci trovate{altre ? " fra quelle caricate" : ""}
        </p>
        {altre && (
          <Button size="sm" variant="outline" onClick={caricaAltre} disabled={caricandoAltre}>
            {caricandoAltre ? "Caricamento…" : "Carica voci più vecchie"}
          </Button>
        )}
      </div>
    </div>
  );
}