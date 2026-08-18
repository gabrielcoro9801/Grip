import React, { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logAction } from "@/lib/auditLog";
import { calcCompensoPT, generaCSVLiquidazioni } from "@/lib/ptValidation";
import { downloadCSV } from "@/lib/presenzeUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, Wallet, FileText, Check, AlertTriangle } from "lucide-react";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";

const MESI = moment.months();
const SOGLIA_ESCLUSIONE = 15000;

export default function PtCompensiPage() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const { organization } = useOrganization();
  const isPT = staffUser?.ruolo === "pt";
  const collaboratoreId = staffUser?.linked_collaboratore_id;
  const [loading, setLoading] = useState(true);
  const [collaboratori, setCollaboratori] = useState([]);
  const [sedute, setSedute] = useState([]);
  const [liquidazioni, setLiquidazioni] = useState([]);
  const [mese, setMese] = useState(moment().month());
  const [anno, setAnno] = useState(moment().year());
  const [filterColl, setFilterColl] = useState("all");

  const loadData = async () => {
    if (isPT && collaboratoreId) {
      const [s, liq] = await Promise.all([
        api.entities.SedutaPT.filter({ collaboratore_id: collaboratoreId }, "-data_ora_inizio", 500),
        api.entities.LiquidazionePT.filter({ collaboratore_id: collaboratoreId }, "-periodo_anno", 100),
      ]);
      setSedute(s); setLiquidazioni(liq);
      setLoading(false);
    } else if (organization?.id) {
      const [colls, s, liq] = await Promise.all([
        api.entities.Collaboratore.filter({ organization_id: organization.id, tipo_rapporto: "collaboratore_sportivo" }),
        api.entities.SedutaPT.list("-data_ora_inizio", 500),
        api.entities.LiquidazionePT.list("-periodo_anno", 200),
      ]);
      setCollaboratori(colls); setSedute(s); setLiquidazioni(liq);
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [organization, collaboratoreId]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  // Cumulo annuo per collaboratore (liquidazioni liquidate nell'anno + autocertificazione altri enti)
  const cumuloAnnuo = (collId) => {
    const liquidatoAnno = liquidazioni
      .filter((l) => l.collaboratore_id === collId && l.periodo_anno === anno && l.stato === "liquidata")
      .reduce((sum, l) => sum + (l.importo_totale || 0), 0);
    const coll = collaboratori.find((c) => c.id === collId);
    const autocert = coll?.importo_autocertificato_altri_enti || 0;
    return liquidatoAnno + autocert;
  };

  // PT view: own liquidazioni
  if (isPT) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold">I miei compensi</h1>
        {liquidazioni.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna liquidazione registrata.</p>
        ) : (
          <div className="space-y-2">
            {liquidazioni.map((l) => (
              <Card key={l.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{MESI[l.periodo_mese]} {l.periodo_anno}</p>
                    <p className="text-xs text-muted-foreground">{l.numero_sedute} sedute · {l.tipo_contratto}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">€{l.importo_totale.toFixed(2)}</p>
                    <Badge variant={l.stato === "liquidata" ? "default" : "secondary"}>{l.stato === "liquidata" ? "Liquidata" : "Bozza"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Admin view
  const selectedColls = filterColl === "all" ? collaboratori : collaboratori.filter((c) => c.id === filterColl);

  const calcolaRiga = (coll) => {
    const svolte = sedute.filter((s) => s.collaboratore_id === coll.id && s.stato === "svolta");
    const compenso = calcCompensoPT(coll, svolte, anno, mese);
    const giaLiquidato = liquidazioni.find(
      (l) => l.collaboratore_id === coll.id && l.periodo_anno === anno && l.periodo_mese === mese && l.stato === "liquidata"
    );
    const cumulo = cumuloAnnuo(coll.id);
    return {
      coll, ...compenso, giaLiquidato,
      periodo: `${MESI[mese]} ${anno}`,
      cumulo,
      superatoSoglia: cumulo > SOGLIA_ESCLUSIONE,
    };
  };

  const righe = selectedColls.map(calcolaRiga);

  const handleGenera = async (riga) => {
    const liq = await api.entities.LiquidazionePT.create({
      collaboratore_id: riga.coll.id,
      collaboratore_nome: `${riga.coll.nome} ${riga.coll.cognome}`,
      periodo_anno: anno,
      periodo_mese: mese,
      numero_sedute: riga.numeroSedute,
      importo_totale: riga.importo,
      tipo_contratto: riga.coll.tipo_contratto,
      stato: "bozza",
    });
    await logAction(staffUser, "create", "pt_compenso", `${riga.coll.nome} ${riga.coll.cognome}`, liq.id, `Liquidazione ${MESI[mese]} ${anno}: €${riga.importo.toFixed(2)}`);
    toast({ title: "Liquidazione creata", description: "In stato bozza — da registrare in contabilità" });
    loadData();
  };

  const handleRegistraFinance = async (riga) => {
    if (!organization?.id) {
      toast({ title: "Errore", description: "Organizzazione non configurata", variant: "destructive" });
      return;
    }
    const je = await api.entities.JournalEntry.create({
      organization_id: organization.id,
      data_competenza: moment().format("YYYY-MM-DD"),
      descrizione: `Compenso ${riga.coll.nome} ${riga.coll.cognome} — ${MESI[mese]} ${anno}`,
      causale: `Liquidazione ${riga.coll.nome} ${riga.coll.cognome}`,
      tipo_origine: "compenso_pt",
      stato: "bozza",
      stato_pagamento: "da_pagare",
    });
    const liq = liquidazioni.find((l) => l.collaboratore_id === riga.coll.id && l.periodo_anno === anno && l.periodo_mese === mese);
    if (liq) {
      await api.entities.LiquidazionePT.update(liq.id, {
        stato: "liquidata",
        journal_entry_id: je.id,
        data_liquidazione: moment().format("YYYY-MM-DD"),
      });
    }
    await logAction(staffUser, "create", "pt_compenso", `${riga.coll.nome} ${riga.coll.cognome}`, je.id, `Movimento contabile creato per liquidazione €${riga.importo.toFixed(2)}`);
    toast({ title: "Movimento creato", description: "Da completare in Prima Nota con le righe di contabilità" });
    loadData();
  };

  const handleExport = () => {
    const csv = generaCSVLiquidazioni(
      righe.map((r) => ({
        collaboratore_nome: `${r.coll.nome} ${r.coll.cognome}`,
        periodo: `${MESI[mese]} ${anno}`,
        tipo_contratto: r.coll.tipo_contratto,
        numero_sedute: r.numeroSedute,
        importo_totale: r.importo,
        stato: r.giaLiquidato ? "liquidata" : "da liquidare",
      }))
    );
    downloadCSV(csv, `liquidazioni_${anno}_${String(mese + 1).padStart(2, "0")}.csv`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Compensi & Liquidazioni</h1>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Mese</Label>
              <Select value={String(mese)} onValueChange={(v) => setMese(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MESI.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Anno</Label>
              <Select value={String(anno)} onValueChange={(v) => setAnno(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[anno - 1, anno, anno + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Collaboratore</Label>
              <Select value={filterColl} onValueChange={setFilterColl}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  {collaboratori.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} {c.cognome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={handleExport}><Download className="w-4 h-4 mr-2" /> Esporta CSV</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {righe.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nessun collaboratore sportivo trovato.</p>
        ) : (
          righe.map((r) => (
            <Card key={r.coll.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-muted-foreground" />
                      <p className="font-medium">{r.coll.nome} {r.coll.cognome}</p>
                      <Badge variant="outline" className="text-xs">{r.coll.tipo_contratto}</Badge>
                      {r.giaLiquidato && <Badge>Liquidata</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {r.numeroSedute} sedute svolte · {r.periodo}
                    </p>
                    <p className="text-lg font-bold mt-1">€{r.importo.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Cumulo anno {anno}: €{r.cumulo.toFixed(2)} {r.coll.importo_autocertificato_altri_enti ? `(incl. €${r.coll.importo_autocertificato_altri_enti.toFixed(2)} altri enti)` : ""}
                    </p>
                    {r.superatoSoglia && (
                      <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>Soglia esenzione compensi sportivi (€{SOGLIA_ESCLUSIONE.toLocaleString("it-IT")}) superata: verificare con il commercialista l'applicazione della ritenuta sull'eccedenza. Stima indicativa.</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!r.giaLiquidato && r.numeroSedute > 0 && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleGenera(r)}><FileText className="w-4 h-4 mr-1" /> Genera bozza</Button>
                        <Button size="sm" onClick={() => handleRegistraFinance(r)}><Check className="w-4 h-4 mr-1" /> Registra in contabilità</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        "Registra in contabilità" crea un movimento in stato bozza (da pagare) con origine "compenso_pt". Completare le righe di contabilità in Prima Nota.
      </p>
    </div>
  );
}