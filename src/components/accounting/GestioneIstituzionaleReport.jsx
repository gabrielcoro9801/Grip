import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Info, Users, Store, Split } from "lucide-react";
import { formatEuro, formatNumero } from "@/lib/format";


// Il segno va prima del simbolo di valuta: "−€100,00", non "€-100,00".
const euro = (n) => `${n < 0 ? "−" : ""}${formatEuro(Math.abs(n))}`;

/**
 * Separa la gestione istituzionale (le quote dei soci e i costi che le servono) da quella
 * commerciale. Serve a rispondere a "come sta andando l'attività associativa" senza
 * ricostruirlo a mano dalla prima nota.
 *
 * I costi promiscui — quelli che servono entrambe le attività — restano volutamente in una
 * colonna a parte invece di essere ripartiti: la percentuale di riparto è una scelta da
 * concordare con il commercialista, e attribuirli d'ufficio darebbe a un numero stimato
 * l'aspetto di un dato certo.
 */
export default function GestioneIstituzionaleReport({ entries, lines, accounts }) {
  const annoCorrente = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState(`${annoCorrente}-01-01`);
  const [dateTo, setDateTo] = useState(`${annoCorrente}-12-31`);

  const dati = useMemo(() => {
    const tipoConto = new Map(accounts.map((a) => [a.id, a.tipo_conto]));

    // Solo le scritture confermate: le bozze sono lavoro non finito e gonfierebbero i totali.
    const entryNatura = new Map(
      entries
        .filter((e) => e.stato === "confermata")
        .filter((e) => !dateFrom || e.data_competenza >= dateFrom)
        .filter((e) => !dateTo || e.data_competenza <= dateTo)
        .map((e) => [e.id, e.natura_fiscale || "non_indicata"])
    );

    const vuoto = () => ({ istituzionale: 0, commerciale: 0, promiscua: 0, non_indicata: 0 });
    const proventi = vuoto();
    const costi = vuoto();

    for (const l of lines) {
      const natura = entryNatura.get(l.journal_entry_id);
      if (!natura) continue;
      const tipo = tipoConto.get(l.conto_id);
      // Le plusvalenze patrimoniali sono ricavi, ma non sono proventi dell'attività:
      // vengono da una cessione di beni, quindi restano fuori da questo confronto.
      if (tipo === "ricavo" && natura !== "plusvalenza_patrimoniale") {
        proventi[natura] = (proventi[natura] ?? 0) + (l.avere || 0);
      }
      if (tipo === "costo") {
        costi[natura] = (costi[natura] ?? 0) + (l.dare || 0);
      }
    }

    const proventiTotali = proventi.istituzionale + proventi.commerciale + proventi.non_indicata;
    return {
      proventi,
      costi,
      proventiTotali,
      saldoIstituzionale: proventi.istituzionale - costi.istituzionale,
      saldoCommerciale: proventi.commerciale - costi.commerciale,
      // Rapporto utile al commercialista per decidere il riparto dei costi promiscui.
      quotaCommerciale: proventiTotali > 0 ? (proventi.commerciale / proventiTotali) * 100 : 0,
    };
  }, [entries, lines, accounts, dateFrom, dateTo]);

  const { proventi, costi, saldoIstituzionale, saldoCommerciale } = dati;

  const colonne = [
    {
      chiave: "istituzionale",
      titolo: "Gestione istituzionale",
      sottotitolo: "Quote e attività verso i soci",
      icona: Users,
      colore: "text-emerald-700",
      sfondo: "bg-emerald-50",
      saldo: saldoIstituzionale,
    },
    {
      chiave: "commerciale",
      titolo: "Gestione commerciale",
      sottotitolo: "Corrispettivi verso terzi",
      icona: Store,
      colore: "text-blue-700",
      sfondo: "bg-blue-50",
      saldo: saldoCommerciale,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs">Dal</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Al</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setDateFrom(`${annoCorrente}-01-01`); setDateTo(`${annoCorrente}-12-31`); }}
        >
          Esercizio {annoCorrente}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {colonne.map((col) => {
          const Icona = col.icona;
          return (
            <Card key={col.chiave} className="border-0 shadow-sm">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className={`${col.sfondo} p-2 rounded-lg`}><Icona className={`w-5 h-5 ${col.colore}`} /></div>
                  <div>
                    <p className="font-heading font-semibold">{col.titolo}</p>
                    <p className="text-xs text-muted-foreground">{col.sottotitolo}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Proventi</span>
                    <span className="font-medium text-emerald-600">{formatEuro(proventi[col.chiave])}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Costi diretti</span>
                    <span className="font-medium text-red-500">−{formatEuro(costi[col.chiave])}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-border">
                    <span className="font-medium">Saldo</span>
                    <span className={`font-bold ${col.saldo >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {euro(col.saldo)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {costi.promiscua > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="bg-amber-50 p-2 rounded-lg"><Split className="w-5 h-5 text-amber-700" /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-heading font-semibold">Costi promiscui da ripartire</p>
                  <span className="font-bold text-amber-700">{formatEuro(costi.promiscua)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Costi che servono entrambe le attività (affitto, utenze e simili). Non sono
                  attribuiti automaticamente: la percentuale di riparto va concordata con il
                  commercialista. Come riferimento, i proventi commerciali sono il{" "}
                  <strong>{dati.quotaCommerciale.toFixed(1)}%</strong> dei proventi complessivi del periodo.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(proventi.non_indicata > 0 || costi.non_indicata > 0) && (
        <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
          <CardContent className="p-5">
            <p className="font-medium text-sm">Movimenti senza natura indicata</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatEuro(proventi.non_indicata)} di proventi e {formatEuro(costi.non_indicata)} di costi non
              risultano attribuiti né alla gestione istituzionale né a quella commerciale, quindi
              non compaiono nei totali qui sopra. Sono registrazioni inserite prima che la
              distinzione fosse tracciata, o registrazioni manuali: vanno riviste perché il
              quadro sia completo.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Il report considera solo le registrazioni confermate del periodo. Le plusvalenze da
          cessione di beni sono escluse dai proventi, perché non derivano dall'attività.
          Prospetto gestionale, non un documento fiscale: da verificare con il commercialista.
        </span>
      </div>
    </div>
  );
}
