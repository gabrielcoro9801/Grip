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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trovaContoPerRuolo } from "../../../shared/contiSistema.js";
import moment from "moment";
import { useToast } from "@/components/ui/use-toast";
import { posizioneSoglia } from "../../../shared/compensiSportivi.js";
import { useParametriFiscali } from "@/hooks/useParametriFiscali";
import { LoadingState } from "@/components/shared/Spinner";
import { formatEuro } from "@/lib/format";

const MESI = moment.months();

export default function PtCompensiPage() {
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const { organization } = useOrganization();
  const isPT = staffUser?.ruolo === "pt";
  // La soglia è quella in vigore nell'anno del compenso, non quella di oggi: è già
  // cambiata una volta e ha conseguenze fiscali per la persona.
  const { dettaglio: dettaglioFiscale } = useParametriFiscali();
  const collaboratoreId = staffUser?.linked_collaboratore_id;
  const [loading, setLoading] = useState(true);
  const [collaboratori, setCollaboratori] = useState([]);
  const [sedute, setSedute] = useState([]);
  const [liquidazioni, setLiquidazioni] = useState([]);
  const [mese, setMese] = useState(moment().month());
  const [anno, setAnno] = useState(moment().year());
  // La soglia dell'anno selezionato, per i testi che la citano.
  const sogliaVisualizzata = (dettaglioFiscale("soglia_compensi_sportivi", `${anno}-12-31`)?.valore ?? 0).toLocaleString("it-IT");
  const [filterColl, setFilterColl] = useState("all");
  // Riga in attesa di conferma perché il compenso tocca la soglia di esenzione.
  const [confermaSoglia, setConfermaSoglia] = useState(null);

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

  if (loading) return <LoadingState minHeight="h-64" />;

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
                    <p className="text-lg font-bold">{formatEuro(l.importo_totale)}</p>
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
    const sogliaAnno = dettaglioFiscale("soglia_compensi_sportivi", `${anno}-12-31`)?.valore;
    if (sogliaAnno === undefined) return null;
    const giaLiquidato = liquidazioni.find(
      (l) => l.collaboratore_id === coll.id && l.periodo_anno === anno && l.periodo_mese === mese && l.stato === "liquidata"
    );
    const cumulo = cumuloAnnuo(coll.id);
    // La posizione si valuta includendo il compenso che si sta per erogare: sapere di aver
    // già sforato serve a poco, sapere che si sta per sforare serve a decidere.
    const soglia = posizioneSoglia({
      giaLiquidato: cumulo - (Number(coll.importo_autocertificato_altri_enti) || 0),
      autocertificatoAltriEnti: Number(coll.importo_autocertificato_altri_enti) || 0,
      compensoInCorso: giaLiquidato ? 0 : compenso.importo,
      dataAutocertificazione: coll.data_autocertificazione,
      soglia: sogliaAnno,
    });
    return {
      coll, ...compenso, giaLiquidato,
      periodo: `${MESI[mese]} ${anno}`,
      cumulo,
      soglia,
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
    await logAction(staffUser, "create", "pt_compenso", `${riga.coll.nome} ${riga.coll.cognome}`, liq.id, `Liquidazione ${MESI[mese]} ${anno}: ${formatEuro(riga.importo)}`);
    toast({ title: "Liquidazione creata", description: "In stato bozza — da registrare in contabilità" });
    loadData();
  };

  const handleRegistraFinance = async (riga) => {
    if (!organization?.id) {
      toast({ title: "Errore", description: "Organizzazione non configurata", variant: "destructive" });
      return;
    }
    // Il momento in cui la soglia conta è questo: dopo aver registrato il compenso,
    // sapere di averla superata serve solo a rimediare.
    if (riga.soglia.superaConQuestoCompenso || riga.soglia.giaOltreSoglia || riga.soglia.autocertificazioneMancante) {
      setConfermaSoglia(riga);
      return;
    }
    await registraCompenso(riga);
  };

  const registraCompenso = async (riga) => {
    // Il compenso è un costo non ancora pagato: costo del personale in dare, debito
    // verso il collaboratore in avere. Il pagamento vero si registra poi da
    // Crediti/Debiti, come per ogni altro debito.
    const accounts = await api.entities.ChartOfAccount.filter({ organization_id: organization.id });
    const contoCosto = trovaContoPerRuolo(accounts, "salari");
    const contoDebito = trovaContoPerRuolo(accounts, "dipendenti_retribuzioni");
    if (!contoCosto || !contoDebito) {
      // Si nomina il compito, non il numero: chi ha rinumerato il piano dei conti non
      // saprebbe cosa cercare con un codice.
      toast({ title: "Conti mancanti", description: "Servono un conto per i salari e uno per i debiti verso il personale. Assegnali dal piano dei conti.", variant: "destructive" });
      return;
    }

    const je = await api.accounting.createJournalEntry(
      {
        organization_id: organization.id,
        data_competenza: moment().format("YYYY-MM-DD"),
        descrizione: `Compenso ${riga.coll.nome} ${riga.coll.cognome} — ${MESI[mese]} ${anno}`,
        causale: `Liquidazione ${riga.coll.nome} ${riga.coll.cognome}`,
        tipo_origine: "compenso_pt",
        stato: "confermata",
        stato_pagamento: "da_pagare",
      },
      [
        { conto_id: contoCosto.id, dare: riga.importo, avere: 0 },
        { conto_id: contoDebito.id, dare: 0, avere: riga.importo },
      ]
    );
    const liq = liquidazioni.find((l) => l.collaboratore_id === riga.coll.id && l.periodo_anno === anno && l.periodo_mese === mese);
    if (liq) {
      await api.entities.LiquidazionePT.update(liq.id, {
        stato: "liquidata",
        journal_entry_id: je.id,
        data_liquidazione: moment().format("YYYY-MM-DD"),
      });
    }
    await logAction(staffUser, "create", "pt_compenso", `${riga.coll.nome} ${riga.coll.cognome}`, je.id, `Movimento contabile creato per liquidazione ${formatEuro(riga.importo)}`);
    toast({ title: "Movimento registrato", description: "Il compenso risulta ora fra i debiti da pagare." });
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
                    <p className="text-lg font-bold mt-1">{formatEuro(r.importo)}</p>
                    {/* Un compenso a zero con delle sedute svolte è quasi sempre una
                        configurazione incompleta, non un compenso davvero nullo: senza
                        dirlo, resta uno zero inspiegabile. */}
                    {r.importo === 0 && r.numeroSedute > 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        {r.coll.tipo_contratto === "percentuale" && !r.coll.percentuale
                          ? "Percentuale non impostata nell'anagrafica del collaboratore."
                          : r.coll.tipo_contratto === "a_seduta" && !r.coll.importo_seduta
                          ? "Importo per seduta non impostato nell'anagrafica del collaboratore."
                          : r.coll.tipo_contratto === "fisso" && !r.coll.importo_fisso
                          ? "Importo fisso non impostato nell'anagrafica del collaboratore."
                          : r.coll.tipo_contratto === "percentuale"
                          ? "Le sedute del periodo non hanno un importo: la percentuale si calcola su quello."
                          : "Tipo di contratto non impostato nell'anagrafica del collaboratore."}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Cumulo anno {anno}: {formatEuro(r.cumulo)} {r.coll.importo_autocertificato_altri_enti ? `(incl. ${formatEuro(r.coll.importo_autocertificato_altri_enti)} altri enti)` : ""}
                    </p>
                    {/* Senza autocertificazione il cumulo vede solo i compensi di questo
                        ente: un "sotto soglia" calcolato così non è affidabile, e va detto
                        prima che qualcuno ci faccia affidamento. */}
                    {r.soglia.autocertificazioneMancante && (
                      <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-muted border border-border text-xs">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          Autocertificazione dei compensi da altri enti non raccolta: il cumulo qui
                          sopra considera solo quanto erogato da questa associazione, quindi la
                          verifica della soglia non è attendibile. Si registra nell'anagrafica del
                          collaboratore, in Team.
                        </span>
                      </div>
                    )}
                    {r.soglia.superaConQuestoCompenso && (
                      <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>Con questo compenso si supera la soglia</strong> di {formatEuro(sogliaVisualizzata)}:
                          il cumulo passerebbe da {formatEuro(r.soglia.cumuloPrima)} a {formatEuro(r.soglia.cumuloDopo)},
                          con {formatEuro(r.soglia.eccedenzaDiQuestoCompenso)} oltre soglia. Verificare con il
                          commercialista il trattamento dell'eccedenza prima di erogare. Stima indicativa.
                        </span>
                      </div>
                    )}
                    {r.soglia.giaOltreSoglia && (
                      <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          Soglia di {formatEuro(sogliaVisualizzata)} già superata: {formatEuro(r.soglia.eccedenza)} oltre
                          soglia sul cumulo annuo. L'intero compenso in corso è oltre la soglia.
                          Verificare con il commercialista. Stima indicativa.
                        </span>
                      </div>
                    )}
                    {!r.soglia.giaOltreSoglia && !r.soglia.superaConQuestoCompenso && r.importo > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Residuo entro soglia dopo questo compenso: {formatEuro(Math.max(0, r.soglia.residuoDisponibile - r.importo))}
                      </p>
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
        "Registra in contabilità" genera la scrittura del compenso — costo del personale in dare, debito verso il collaboratore in avere — e lo fa comparire fra i debiti da pagare. Il pagamento si registra poi da Crediti/Debiti.
      </p>

      {/* La registrazione non viene impedita: la decisione resta di chi gestisce, ma va
          presa sapendo. Bloccare sarebbe sbagliato — superare la soglia è legittimo, va
          solo trattato fiscalmente nel modo giusto. */}
      <Dialog open={!!confermaSoglia} onOpenChange={(v) => { if (!v) setConfermaSoglia(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Soglia compensi sportivi</DialogTitle></DialogHeader>
          {confermaSoglia && (
            <div className="space-y-3">
              <p className="text-sm">
                Compenso a <strong>{confermaSoglia.coll.nome} {confermaSoglia.coll.cognome}</strong> di
                {formatEuro(confermaSoglia.importo)} per {MESI[mese]} {anno}.
              </p>

              {confermaSoglia.soglia.autocertificazioneMancante && (
                <div className="p-3 rounded-lg bg-muted border border-border text-sm">
                  <p className="font-medium">Autocertificazione non raccolta</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Il cumulo considera solo i compensi erogati da questa associazione. Se il
                    collaboratore ha percepito compensi sportivi da altri enti, la soglia potrebbe
                    essere già superata senza che risulti qui.
                  </p>
                </div>
              )}

              {(confermaSoglia.soglia.superaConQuestoCompenso || confermaSoglia.soglia.giaOltreSoglia) && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-1">
                  <div className="flex justify-between"><span>Cumulo prima</span><span>{formatEuro(confermaSoglia.soglia.cumuloPrima)}</span></div>
                  <div className="flex justify-between"><span>Cumulo dopo</span><span className="font-medium">{formatEuro(confermaSoglia.soglia.cumuloDopo)}</span></div>
                  <div className="flex justify-between pt-1 border-t border-amber-200">
                    <span>Oltre la soglia di {formatEuro(sogliaVisualizzata)}</span>
                    <span className="font-bold">{formatEuro(confermaSoglia.soglia.eccedenza)}</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Superare la soglia non impedisce di erogare il compenso: cambia il trattamento
                fiscale dell'eccedenza, da concordare con il commercialista. Stima indicativa.
              </p>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfermaSoglia(null)}>Annulla</Button>
                <Button
                  className="flex-1"
                  onClick={async () => { const r = confermaSoglia; setConfermaSoglia(null); await registraCompenso(r); }}
                >
                  Registra comunque
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}