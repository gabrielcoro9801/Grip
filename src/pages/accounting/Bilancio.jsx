import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/shared/PageHeader";
import { AlertTriangle, Info, TrendingUp, Scale, Wallet, Users } from "lucide-react";
import moment from "moment";

const fmt = (n) => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = (n) => `${n < 0 ? "−" : ""}€${fmt(Math.abs(n))}`;

/**
 * Bilancio provvisorio: un'unica pagina che risponde a "come sta andando l'associazione".
 *
 * Tiene insieme quattro letture che da sole dicono poco:
 *  - conto economico: se l'attività genera o consuma risorse;
 *  - stato patrimoniale: cosa si possiede e cosa si deve;
 *  - flusso di cassa: quanta liquidità è entrata e uscita davvero;
 *  - gestione istituzionale: quanta parte dell'attività è verso i soci.
 *
 * È un prospetto gestionale, non un bilancio da depositare: si basa sulle registrazioni
 * inserite finora, che a esercizio aperto sono per definizione incomplete.
 */
export default function Bilancio() {
  const { organization, loading: orgLoading } = useOrganization();
  const annoCorrente = new Date().getFullYear();
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(`${annoCorrente}-01-01`);
  const [dateTo, setDateTo] = useState(`${annoCorrente}-12-31`);

  const [chiusure, setChiusure] = useState([]);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [e, a, c] = await Promise.all([
      api.entities.JournalEntry.filter({ organization_id: organization.id, stato: "confermata" }),
      api.entities.ChartOfAccount.filter({ organization_id: organization.id }),
      api.entities.ExerciseClosure.filter({ organization_id: organization.id }),
    ]);
    let l = [];
    if (e.length > 0) {
      const ids = new Set(e.map(x => x.id));
      l = (await api.entities.JournalLine.filter({})).filter(x => ids.has(x.journal_entry_id));
    }
    setEntries(e); setLines(l); setAccounts(a); setChiusure(c); setLoading(false);
  }, [organization]);

  useEffect(() => { loadData(); }, [loadData]);

  const dati = useMemo(() => {
    const contoById = new Map(accounts.map(a => [a.id, a]));
    const entryById = new Map(entries.map(e => [e.id, e]));

    const nelPeriodo = (e) => (!dateFrom || e.data_competenza >= dateFrom) && (!dateTo || e.data_competenza <= dateTo);
    // La data che conta per la liquidità è quella del movimento di cassa, non di competenza.
    const dataCassa = (e) => e.data_cassa || e.data_competenza;

    // --- Conto economico: solo il periodo scelto ---
    const perTipo = { ricavo: 0, costo: 0 };
    const dettaglioRicavi = new Map();
    const dettaglioCosti = new Map();
    // --- Natura fiscale, per la sezione istituzionale ---
    const proventiPerNatura = { istituzionale: 0, commerciale: 0, promiscua: 0, non_indicata: 0 };
    const costiPerNatura = { istituzionale: 0, commerciale: 0, promiscua: 0, non_indicata: 0 };

    // --- Stato patrimoniale: cumulativo fino alla data di fine, non solo il periodo ---
    const saldiPatrimoniali = new Map();
    // --- Flusso di cassa ---
    let cassaIniziale = 0, entrateCassa = 0, usciteCassa = 0;

    for (const l of lines) {
      const e = entryById.get(l.journal_entry_id);
      const conto = contoById.get(l.conto_id);
      if (!e || !conto) continue;
      const dare = Number(l.dare) || 0;
      const avere = Number(l.avere) || 0;

      // La scrittura di chiusura gira proventi e oneri a patrimonio netto: se entrasse nel
      // conto economico li azzererebbe, e l'anno chiuso risulterebbe senza attività.
      // Va esclusa da qui e considerata solo nel patrimonio.
      const eDiChiusura = e.tipo_origine === "chiusura_esercizio";

      if (nelPeriodo(e) && !eDiChiusura) {
        if (conto.tipo_conto === "ricavo") {
          perTipo.ricavo += avere;
          dettaglioRicavi.set(conto.id, (dettaglioRicavi.get(conto.id) || 0) + avere);
          const n = e.natura_fiscale || "non_indicata";
          if (n !== "plusvalenza_patrimoniale") proventiPerNatura[n] = (proventiPerNatura[n] ?? 0) + avere;
        }
        if (conto.tipo_conto === "costo") {
          perTipo.costo += dare;
          dettaglioCosti.set(conto.id, (dettaglioCosti.get(conto.id) || 0) + dare);
          const n = e.natura_fiscale || "non_indicata";
          costiPerNatura[n] = (costiPerNatura[n] ?? 0) + dare;
        }
      }

      // Il patrimonio è una fotografia a una data: include tutto ciò che è avvenuto prima.
      if (!dateTo || e.data_competenza <= dateTo) {
        if (["attivo", "passivo", "patrimonio_netto"].includes(conto.tipo_conto)) {
          const segno = conto.tipo_conto === "attivo" ? dare - avere : avere - dare;
          saldiPatrimoniali.set(conto.id, (saldiPatrimoniali.get(conto.id) || 0) + segno);
        }
      }

      // Liquidità: conti del gruppo 2 nel piano predefinito.
      if (conto.codice?.startsWith("2.")) {
        const d = dataCassa(e);
        if (dateFrom && d < dateFrom) cassaIniziale += dare - avere;
        else if ((!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)) {
          entrateCassa += dare;
          usciteCassa += avere;
        }
      }
    }

    const risultato = perTipo.ricavo - perTipo.costo;

    const voci = (mappa) => [...mappa.entries()]
      .map(([id, importo]) => ({ conto: contoById.get(id), importo }))
      .filter(v => v.conto && v.importo !== 0)
      .sort((a, b) => b.importo - a.importo);

    const patrimoniali = (tipo) => [...saldiPatrimoniali.entries()]
      .map(([id, saldo]) => ({ conto: contoById.get(id), saldo }))
      .filter(v => v.conto?.tipo_conto === tipo && Math.abs(v.saldo) > 0.005)
      .sort((a, b) => b.saldo - a.saldo);

    const attivo = patrimoniali("attivo");
    const passivo = patrimoniali("passivo");
    const patrimonioNetto = patrimoniali("patrimonio_netto");

    const totAttivo = attivo.reduce((s, v) => s + v.saldo, 0);
    const totPassivo = passivo.reduce((s, v) => s + v.saldo, 0);
    const totPatrimonioNetto = patrimonioNetto.reduce((s, v) => s + v.saldo, 0);

    // A esercizio chiuso il risultato è già stato girato a patrimonio netto: sommarlo di
    // nuovo lo conterebbe due volte. Finché l'esercizio è aperto, invece, va aggiunto
    // perché non è ancora confluito da nessuna parte.
    const annoPeriodo = Number(String(dateTo || dateFrom || "").slice(0, 4));
    const esercizioChiuso = chiusure.some(c => c.anno === annoPeriodo);
    const risultatoDaSommare = esercizioChiuso ? 0 : risultato;

    // Ogni registrazione ha dare uguale ad avere, quindi il patrimonio deve quadrare da sé.
    // Se non torna, di norma significa che qualche conto è privo di classificazione, non
    // che la contabilità sia sbagliata.
    const sbilancio = totAttivo - (totPassivo + totPatrimonioNetto + risultatoDaSommare);
    const contiSenzaTipo = accounts.filter(a => !a.tipo_conto);

    return {
      ricavi: perTipo.ricavo, costi: perTipo.costo, risultato,
      vociRicavi: voci(dettaglioRicavi), vociCosti: voci(dettaglioCosti),
      attivo, passivo, patrimonioNetto, totAttivo, totPassivo, totPatrimonioNetto,
      sbilancio, contiSenzaTipo, esercizioChiuso, risultatoDaSommare,
      cassaIniziale, entrateCassa, usciteCassa, cassaFinale: cassaIniziale + entrateCassa - usciteCassa,
      proventiPerNatura, costiPerNatura,
    };
  }, [entries, lines, accounts, chiusure, dateFrom, dateTo]);

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  const Sezione = ({ icona: Icona, titolo, descrizione, children }) => (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="bg-muted p-2 rounded-lg"><Icona className="w-5 h-5 text-muted-foreground" /></div>
          <div>
            <p className="font-heading font-semibold">{titolo}</p>
            <p className="text-xs text-muted-foreground">{descrizione}</p>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );

  const Riga = ({ etichetta, valore, forte, sfumato }) => (
    <div className={`flex justify-between ${forte ? "pt-2 border-t border-border font-semibold" : ""}`}>
      <span className={sfumato ? "text-muted-foreground" : ""}>{etichetta}</span>
      <span className={forte && valore < 0 ? "text-red-500" : ""}>{euro(valore)}</span>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Bilancio provvisorio" description="Come sta andando l'associazione nel periodo scelto" />

      <div className="flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">Dal</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">Al</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" /></div>
        <Button variant="outline" size="sm" onClick={() => { setDateFrom(`${annoCorrente}-01-01`); setDateTo(`${annoCorrente}-12-31`); }}>
          Esercizio {annoCorrente}
        </Button>
      </div>

      {Math.abs(dati.sbilancio) > 0.01 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Il patrimonio non quadra per {euro(dati.sbilancio)}</p>
            <p className="text-xs mt-0.5">
              {dati.contiSenzaTipo.length > 0
                ? `Ci sono ${dati.contiSenzaTipo.length} conti senza tipo assegnato (${dati.contiSenzaTipo.map(c => c.codice).join(", ")}): finché non sono classificati non rientrano nel prospetto.`
                : "Ogni registrazione è bilanciata, quindi lo sbilancio indica una classificazione mancante o errata nel piano dei conti."}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Sezione icona={TrendingUp} titolo="Conto economico" descrizione="Risorse generate e consumate nel periodo">
          <div className="space-y-1.5 text-sm">
            {dati.vociRicavi.map(v => <Riga key={v.conto.id} etichetta={`${v.conto.codice} ${v.conto.nome}`} valore={v.importo} sfumato />)}
            <Riga etichetta="Totale proventi" valore={dati.ricavi} forte />
            <div className="h-2" />
            {dati.vociCosti.map(v => <Riga key={v.conto.id} etichetta={`${v.conto.codice} ${v.conto.nome}`} valore={-v.importo} sfumato />)}
            <Riga etichetta="Totale oneri" valore={-dati.costi} forte />
            <div className="h-3" />
            <div className="flex justify-between pt-3 border-t-2 border-border text-base font-bold">
              <span>{dati.risultato >= 0 ? "Avanzo di gestione" : "Disavanzo di gestione"}</span>
              <span className={dati.risultato >= 0 ? "text-emerald-600" : "text-red-500"}>{euro(dati.risultato)}</span>
            </div>
          </div>
        </Sezione>

        <Sezione icona={Scale} titolo="Stato patrimoniale" descrizione={`Cosa si possiede e cosa si deve al ${moment(dateTo).format("DD/MM/YYYY")}`}>
          <div className="space-y-1.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attivo</p>
            {dati.attivo.length === 0
              ? <p className="text-xs text-muted-foreground">Nessuna voce</p>
              : dati.attivo.map(v => <Riga key={v.conto.id} etichetta={`${v.conto.codice} ${v.conto.nome}`} valore={v.saldo} sfumato />)}
            <Riga etichetta="Totale attivo" valore={dati.totAttivo} forte />
            <div className="h-3" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Passivo e patrimonio netto</p>
            {dati.passivo.map(v => <Riga key={v.conto.id} etichetta={`${v.conto.codice} ${v.conto.nome}`} valore={v.saldo} sfumato />)}
            {dati.patrimonioNetto.map(v => <Riga key={v.conto.id} etichetta={`${v.conto.codice} ${v.conto.nome}`} valore={v.saldo} sfumato />)}
            {dati.esercizioChiuso ? (
              <p className="text-xs text-muted-foreground pt-1">
                Esercizio chiuso: il risultato è già compreso nel patrimonio netto qui sopra.
              </p>
            ) : (
              <Riga etichetta={dati.risultato >= 0 ? "Avanzo del periodo" : "Disavanzo del periodo"} valore={dati.risultato} sfumato />
            )}
            <Riga etichetta="Totale passivo e netto" valore={dati.totPassivo + dati.totPatrimonioNetto + dati.risultatoDaSommare} forte />
          </div>
        </Sezione>

        <Sezione icona={Wallet} titolo="Flusso di cassa" descrizione="Liquidità realmente entrata e uscita nel periodo">
          <div className="space-y-1.5 text-sm">
            <Riga etichetta={`Liquidità al ${moment(dateFrom).format("DD/MM/YYYY")}`} valore={dati.cassaIniziale} sfumato />
            <Riga etichetta="Incassi" valore={dati.entrateCassa} sfumato />
            <Riga etichetta="Pagamenti" valore={-dati.usciteCassa} sfumato />
            <Riga etichetta={`Liquidità al ${moment(dateTo).format("DD/MM/YYYY")}`} valore={dati.cassaFinale} forte />
          </div>
          <p className="text-xs text-muted-foreground">
            Diverso dall'avanzo di gestione: un ricavo fatturato ma non ancora incassato migliora
            il risultato senza portare denaro in cassa.
          </p>
        </Sezione>

        <Sezione icona={Users} titolo="Gestione istituzionale" descrizione="Quanta parte dell'attività è verso i soci">
          <div className="space-y-1.5 text-sm">
            <Riga etichetta="Proventi istituzionali" valore={dati.proventiPerNatura.istituzionale} sfumato />
            <Riga etichetta="Proventi commerciali" valore={dati.proventiPerNatura.commerciale} sfumato />
            <div className="h-2" />
            <Riga etichetta="Oneri istituzionali" valore={-dati.costiPerNatura.istituzionale} sfumato />
            <Riga etichetta="Oneri commerciali" valore={-dati.costiPerNatura.commerciale} sfumato />
            <Riga etichetta="Oneri promiscui (da ripartire)" valore={-dati.costiPerNatura.promiscua} sfumato />
            <Riga
              etichetta="Saldo istituzionale"
              valore={dati.proventiPerNatura.istituzionale - dati.costiPerNatura.istituzionale}
              forte
            />
          </div>
          {(dati.proventiPerNatura.non_indicata > 0 || dati.costiPerNatura.non_indicata > 0) && (
            <p className="text-xs text-amber-700">
              {euro(dati.proventiPerNatura.non_indicata)} di proventi e {euro(dati.costiPerNatura.non_indicata)} di
              oneri non hanno una natura indicata e restano fuori da questa sezione.
            </p>
          )}
        </Sezione>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Prospetto gestionale, non un bilancio da depositare. Considera solo le registrazioni
          confermate e, a esercizio aperto, fotografa una situazione per definizione incompleta:
          mancano le scritture di assestamento (ammortamenti, ratei, risconti) che si fanno in
          chiusura. Da verificare con il commercialista.
        </span>
      </div>
    </div>
  );
}
