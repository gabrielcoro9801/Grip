import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import { AlertTriangle, Download, Lock, Calculator, FileSpreadsheet, CheckCircle2, Split } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { stimaIres } from "../../../shared/ires.js";
import { useParametriFiscali } from "@/hooks/useParametriFiscali";
import moment from "moment";
import { puo } from "@/lib/permissions";

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = (n) => `${n < 0 ? "−" : ""}€${fmt(Math.abs(n))}`;

function scaricaCsv(nomeFile, righe) {
  const csv = righe.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FineEsercizio() {
  const { organization, loading: orgLoading } = useOrganization();
  const { staffUser } = useStaffAuth();
  const { toast } = useToast();
  const annoCorrente = new Date().getFullYear();

  const [anno, setAnno] = useState(annoCorrente);
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [chiusure, setChiusure] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confermaChiusura, setConfermaChiusura] = useState(false);
  const [noteChiusura, setNoteChiusura] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [e, a, c] = await Promise.all([
      api.entities.JournalEntry.filter({ organization_id: organization.id, stato: "confermata" }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
      api.entities.ExerciseClosure.filter({ organization_id: organization.id }),
    ]);
    let l = [];
    if (e.length > 0) {
      const ids = new Set(e.map((x) => x.id));
      l = (await api.entities.JournalLine.filter({})).filter((x) => ids.has(x.journal_entry_id));
    }
    setEntries(e); setLines(l); setAccounts(a); setChiusure(c); setLoading(false);
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  // Aliquota e coefficiente sono quelli in vigore *nell'esercizio che si chiude*, non quelli
  // di oggi: chiudere il 2026 nel 2028 deve dare lo stesso numero di allora.
  const { parametri, dettaglio: dettaglioFiscale } = useParametriFiscali();

  // Gli ultimi giorni dell'esercizio sono la data che decide quali valori applicare.
  const dataRiferimento = `${anno}-12-31`;
  const aliquotaIres = dettaglioFiscale("aliquota_ires", dataRiferimento);
  const coefficiente398 = dettaglioFiscale("coefficiente_redditivita_398", dataRiferimento);
  const parametriIres = aliquotaIres && coefficiente398
    ? { aliquota: aliquotaIres.valore, coefficiente: coefficiente398.valore }
    : null;

  const dati = useMemo(() => {
    const contoById = new Map(accounts.map((a) => [a.id, a]));
    const dellAnno = new Map(
      entries.filter((e) => String(e.data_competenza).startsWith(String(anno))).map((e) => [e.id, e])
    );

    let proventiCommerciali = 0;
    let plusvalenze = 0;
    let proventiIstituzionali = 0;
    // Proventi promiscui (servono sia l'attività istituzionale sia quella commerciale) o
    // senza natura fiscale indicata: non appartengono né all'uno né all'altro totale, e
    // sommarli d'ufficio a uno dei due significherebbe dichiarare come commerciale — o come
    // istituzionale — un provento che non lo è per forza. Restano una voce a parte, da
    // ripartire con un criterio concordato col commercialista.
    let proventiDaRipartire = 0;
    let totaleCosti = 0;
    let ivaADebito = 0;
    const perConto = new Map();

    for (const l of lines) {
      const e = dellAnno.get(l.journal_entry_id);
      const conto = contoById.get(l.conto_id);
      if (!e || !conto) continue;
      const dare = Number(l.dare) || 0;
      const avere = Number(l.avere) || 0;

      if (conto.tipo_conto === "ricavo") {
        // Le plusvalenze concorrono per intero all'imponibile, gli altri proventi
        // commerciali solo per il coefficiente di redditività: vanno tenuti distinti.
        if (e.natura_fiscale === "plusvalenza_patrimoniale" || conto.ruolo_sistema === "plusvalenze") plusvalenze += avere;
        else if (e.natura_fiscale === "commerciale") proventiCommerciali += avere;
        else if (e.natura_fiscale === "istituzionale") proventiIstituzionali += avere;
        else proventiDaRipartire += avere;
      }
      if (conto.tipo_conto === "costo") totaleCosti += dare;
      if (conto.ruolo_sistema === "iva_debito") ivaADebito += avere;

      const chiave = conto.id;
      const acc = perConto.get(chiave) || { conto, dare: 0, avere: 0 };
      acc.dare += dare; acc.avere += avere;
      perConto.set(chiave, acc);
    }

    return {
      ires: parametriIres ? stimaIres(proventiCommerciali, plusvalenze, parametriIres) : null,
      proventiIstituzionali, proventiDaRipartire, totaleCosti, ivaADebito,
      perConto: [...perConto.values()].sort((a, b) => a.conto.codice.localeCompare(b.conto.codice)),
      numeroScritture: dellAnno.size,
      scrittureAnno: dellAnno,
    };
  }, [entries, lines, accounts, anno, parametriIres]);

  const chiusuraAnno = chiusure.find((c) => c.anno === anno);
  const puoChiudere = puo(staffUser?.ruolo, "chiudere_esercizio");

  const esportaRiepilogo = () => {
    const i = dati.ires;
    if (!i) return;
    scaricaCsv(`riepilogo-fiscale-${anno}.csv`, [
      ["Ente", organization?.ragione_sociale || organization?.nome || ""],
      ["Partita IVA / C.F.", organization?.piva_cf || ""],
      ["Esercizio", anno],
      [],
      ["Voce", "Importo"],
      ["Proventi commerciali", i.proventiCommerciali.toFixed(2)],
      ["Proventi istituzionali", dati.proventiIstituzionali.toFixed(2)],
      ["Proventi da ripartire (natura promiscua o non indicata)", dati.proventiDaRipartire.toFixed(2)],
      ["Plusvalenze patrimoniali", i.plusvalenze.toFixed(2)],
      ["Totale oneri (non rilevanti in regime 398/1991)", dati.totaleCosti.toFixed(2)],
      ["IVA a debito registrata", dati.ivaADebito.toFixed(2)],
      [],
      ["Stima IRES", ""],
      [`Reddito da proventi commerciali (${i.coefficiente}%)`, i.redditoDaProventi.toFixed(2)],
      ["Plusvalenze (per intero)", i.plusvalenze.toFixed(2)],
      ["Imponibile stimato", i.imponibile.toFixed(2)],
      [`IRES stimata (${i.aliquota}%)`, i.imposta.toFixed(2)],
      [],
      ["Stima indicativa: non considera variazioni fiscali, perdite pregresse o agevolazioni. Da verificare con il commercialista."],
    ]);
  };

  const esportaSaldiConti = () => {
    scaricaCsv(`saldi-conti-${anno}.csv`, [
      ["Codice", "Conto", "Tipo", "Dare", "Avere", "Saldo"],
      ...dati.perConto.map((v) => [
        v.conto.codice, v.conto.nome, v.conto.tipo_conto || "",
        v.dare.toFixed(2), v.avere.toFixed(2), (v.dare - v.avere).toFixed(2),
      ]),
    ]);
  };

  const esportaRegistro = () => {
    const contoById = new Map(accounts.map((a) => [a.id, a]));
    const righe = [["Protocollo", "Data competenza", "Data cassa", "Descrizione", "Natura fiscale", "Conto", "Dare", "Avere"]];
    for (const l of lines) {
      const e = dati.scrittureAnno.get(l.journal_entry_id);
      if (!e) continue;
      const c = contoById.get(l.conto_id);
      righe.push([
        e.numero_protocollo, e.data_competenza, e.data_cassa || "", e.descrizione || "",
        e.natura_fiscale || "", c ? `${c.codice} ${c.nome}` : "",
        Number(l.dare || 0).toFixed(2), Number(l.avere || 0).toFixed(2),
      ]);
    }
    scaricaCsv(`registro-movimenti-${anno}.csv`, righe);
  };

  const chiudiEsercizio = async () => {
    setSaving(true);
    try {
      await api.accounting.closeExercise({ organization_id: organization.id, anno, note: noteChiusura || undefined });
      toast({ title: `Esercizio ${anno} chiuso`, description: "Il risultato è stato girato a patrimonio netto." });
      setConfermaChiusura(false);
      setNoteChiusura("");
      loadData();
    } catch (err) {
      toast({ title: "Chiusura non riuscita", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  const i = dati.ires;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Fine esercizio" description="Stima delle imposte, dati per il commercialista e chiusura dell'anno" />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <Label className="text-xs">Esercizio</Label>
          <Input type="number" value={anno} onChange={(e) => setAnno(Number(e.target.value))} />
        </div>
        {chiusuraAnno ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            <Lock className="w-3 h-3 mr-1" /> Chiuso il {moment(chiusuraAnno.chiuso_il).format("DD/MM/YYYY")}
          </Badge>
        ) : (
          <Badge variant="outline">Aperto · {dati.numeroScritture} registrazioni</Badge>
        )}
      </div>

      {/* Stima IRES */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-muted p-2 rounded-lg"><Calculator className="w-5 h-5 text-muted-foreground" /></div>
            <div>
              <p className="font-heading font-semibold">Stima IRES</p>
              <p className="text-xs text-muted-foreground">Regime forfetario legge 398/1991</p>
            </div>
          </div>

          {!i ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Non sono noti aliquota IRES e coefficiente di redditività in vigore nel {anno}:
                senza, la stima non si può fare. Vanno aggiunti fra i parametri fiscali indicando
                da quando valgono — meglio nessun numero che un numero calcolato su un'aliquota
                sbagliata.
              </span>
            </div>
          ) : (
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Proventi commerciali</span><span>{euro(i.proventiCommerciali)}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reddito imponibile da proventi ({i.coefficiente}%)</span>
              <span>{euro(i.redditoDaProventi)}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Plusvalenze patrimoniali (per intero)</span><span>{euro(i.plusvalenze)}</span></div>
            <div className="flex justify-between pt-2 border-t border-border font-semibold"><span>Imponibile stimato</span><span>{euro(i.imponibile)}</span></div>
            <div className="flex justify-between pt-2 border-t-2 border-border text-base font-bold">
              <span>IRES stimata ({i.aliquota}%)</span>
              <span>{euro(i.imposta)}</span>
            </div>
          </div>
          )}

          {i && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Stima indicativa.</strong> In regime 398/1991 il reddito si determina applicando il
              coefficiente del {i?.coefficiente}% ai proventi commerciali: i costi effettivi non
              incidono, mentre le plusvalenze concorrono per intero. Non sono considerate variazioni
              fiscali, perdite pregresse né agevolazioni. Da verificare sempre con il commercialista
              prima di qualunque versamento.
            </span>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Proventi da ripartire: natura promiscua o non indicata, esclusi dai due totali qui sopra */}
      {dati.proventiDaRipartire > 0 && (
        <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="bg-amber-50 p-2 rounded-lg"><Split className="w-5 h-5 text-amber-700" /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-heading font-semibold">Proventi da ripartire</p>
                  <span className="font-bold text-amber-700">{euro(dati.proventiDaRipartire)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Proventi con natura fiscale promiscua — servono sia l'attività istituzionale sia
                  quella commerciale — o senza natura fiscale indicata. Non entrano nella stima IRES
                  qui sopra, che considera solo i proventi già attribuiti alla gestione commerciale:
                  attribuirli d'ufficio a un totale o all'altro darebbe alla stima un numero certo che
                  non lo è. Vanno rivisti e ripartiti con un criterio concordato con il commercialista.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-muted p-2 rounded-lg"><FileSpreadsheet className="w-5 h-5 text-muted-foreground" /></div>
            <div>
              <p className="font-heading font-semibold">Dati per il commercialista</p>
              <p className="text-xs text-muted-foreground">Export strutturati dell'esercizio {anno}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Sono i dati con cui si compila il Modello Redditi ENC, non il modello compilato: la
            dichiarazione resta di competenza del commercialista, che qui riceve numeri già pronti
            invece di doverli ricostruire dalla prima nota.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={esportaRiepilogo}><Download className="w-4 h-4 mr-1" /> Riepilogo fiscale</Button>
            <Button variant="outline" size="sm" onClick={esportaSaldiConti}><Download className="w-4 h-4 mr-1" /> Saldi dei conti</Button>
            <Button variant="outline" size="sm" onClick={esportaRegistro}><Download className="w-4 h-4 mr-1" /> Registro movimenti</Button>
          </div>
        </CardContent>
      </Card>

      {/* Chiusura */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-muted p-2 rounded-lg"><Lock className="w-5 h-5 text-muted-foreground" /></div>
            <div>
              <p className="font-heading font-semibold">Chiusura dell'esercizio</p>
              <p className="text-xs text-muted-foreground">Destinazione del risultato e blocco delle scritture</p>
            </div>
          </div>

          {chiusuraAnno ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Esercizio {anno} chiuso il {moment(chiusuraAnno.chiuso_il).format("DD/MM/YYYY")}</p>
                  <p className="text-xs mt-0.5">
                    Risultato girato a patrimonio netto: {euro(Number(chiusuraAnno.risultato))}.
                    Le registrazioni con competenza {anno} non sono più modificabili.
                  </p>
                  {chiusuraAnno.note && <p className="text-xs mt-1 italic">{chiusuraAnno.note}</p>}
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Chiudere l'esercizio gira il risultato al conto <strong>5.2 Utili/perdite a nuovo</strong>,
                azzerando proventi e oneri dell'anno, e impedisce di aggiungere o modificare
                registrazioni con competenza {anno}. Serve perché i dati dell'anno vengono usati per
                una dichiarazione: modificarli dopo significherebbe avere numeri diversi da quelli
                presentati, senza che nessuno se ne accorga.
              </p>
              {!puoChiudere ? (
                <p className="text-sm text-muted-foreground italic">Solo un amministratore può chiudere un esercizio.</p>
              ) : (
                <Button variant="destructive" onClick={() => setConfermaChiusura(true)} disabled={dati.numeroScritture === 0}>
                  <Lock className="w-4 h-4 mr-1" /> Chiudi esercizio {anno}
                </Button>
              )}
              {dati.numeroScritture === 0 && (
                <p className="text-xs text-muted-foreground">Nessuna registrazione confermata nel {anno}: non c'è nulla da chiudere.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confermaChiusura} onOpenChange={setConfermaChiusura}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Chiudere l'esercizio {anno}?</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Operazione non reversibile dall'interfaccia. Prima di procedere, verifica con il
                commercialista che le scritture di assestamento dell'anno (ammortamenti, ratei,
                risconti) siano state registrate: dopo la chiusura non sarà più possibile aggiungerle.
              </span>
            </div>
            <div>
              <Label>Note (facoltative)</Label>
              <Textarea value={noteChiusura} onChange={(e) => setNoteChiusura(e.target.value)} placeholder="es. bilancio approvato in assemblea del…" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfermaChiusura(false)}>Annulla</Button>
              <Button variant="destructive" className="flex-1" onClick={chiudiEsercizio} disabled={saving}>
                {saving ? "Chiusura…" : "Chiudi definitivamente"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
