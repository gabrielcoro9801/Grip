import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Cog } from "lucide-react";
import { RUOLI_SISTEMA, NOMI_RUOLI, trovaContoPerRuolo, ruoliIncoerenti } from "../../../shared/contiSistema.js";

const TIPO_LABELS = {
  attivo: "Attivo",
  passivo: "Passivo",
  patrimonio_netto: "Patrimonio netto",
  ricavo: "Ricavo",
  costo: "Costo",
};

/**
 * Quale conto svolge quale compito per il motore contabile.
 *
 * Serve perché il legame fra motore e piano dei conti non è più il numero — che l'ente può
 * cambiare quando vuole — ma un ruolo assegnato al conto. Questo legame è invisibile
 * guardando l'elenco dei conti, e un ruolo scoperto non dà segno di sé finché qualcuno non
 * prova a registrare: succede a fine mese, col cedolino.
 *
 * Da qui i due avvisi. Il primo è netto: senza quel conto certe registrazioni non partono.
 * Il secondo è più insidioso — un ruolo assegnato a un conto del tipo sbagliato non blocca
 * niente, produce solo un bilancio storto.
 */
export default function MappaRuoliConti({ accounts, onAssegna }) {
  const scoperti = NOMI_RUOLI.filter((r) => !trovaContoPerRuolo(accounts, r));
  const incoerenti = ruoliIncoerenti(accounts);
  const assegnati = NOMI_RUOLI.length - scoperti.length;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-heading flex items-center gap-2">
          <Cog className="w-4 h-4" /> Compiti dei conti
          <Badge variant="outline" className="ml-1 text-xs font-normal">{assegnati}/{NOMI_RUOLI.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Alcuni conti hanno un compito preciso: è da lì che l'applicazione sa dove registrare
          la cassa, l'IVA o le voci del cedolino. Il legame passa dal compito, non dal numero,
          quindi <strong>puoi rinumerare i conti come preferisci</strong> senza rompere niente.
        </p>

        {scoperti.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">
                {scoperti.length === 1 ? "Un compito non è assegnato a nessun conto." : `${scoperti.length} compiti non sono assegnati a nessun conto.`}
              </p>
              <p className="mt-0.5">Le registrazioni che ne hanno bisogno non potranno essere completate:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {scoperti.map((r) => <li key={r}><strong>{RUOLI_SISTEMA[r].label}</strong> — {RUOLI_SISTEMA[r].descrizione}</li>)}
              </ul>
            </div>
          </div>
        )}

        {incoerenti.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-900">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Un compito è assegnato a un conto di tipo inatteso.</p>
              <p className="mt-0.5">
                Non blocca le registrazioni, ma se non è voluto il bilancio risulterà sbagliato
                senza dare errori:
              </p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {incoerenti.map((i) => (
                  <li key={i.conto.id}>
                    <strong>{RUOLI_SISTEMA[i.ruolo].label}</strong> è su {i.conto.codice} {i.conto.nome},
                    che è di tipo {TIPO_LABELS[i.conto.tipo_conto]} invece di {TIPO_LABELS[i.tipoAtteso]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {scoperti.length === 0 && incoerenti.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            Tutti i compiti sono assegnati a un conto del tipo giusto.
          </div>
        )}

        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">Compito</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">Conto assegnato</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right w-24"></th>
              </tr>
            </thead>
            <tbody>
              {NOMI_RUOLI.map((r) => {
                const conto = trovaContoPerRuolo(accounts, r);
                return (
                  <tr key={r} className="border-b border-border/50">
                    <td className="py-2 px-3">
                      <span className="font-medium">{RUOLI_SISTEMA[r].label}</span>
                      <span className="block text-xs text-muted-foreground">{RUOLI_SISTEMA[r].descrizione}</span>
                    </td>
                    <td className="py-2 px-3">
                      {conto ? (
                        <span className="whitespace-nowrap"><span className="font-mono text-muted-foreground">{conto.codice}</span> {conto.nome}</span>
                      ) : (
                        <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">non assegnato</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {conto && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onAssegna?.(conto)}>
                          Modifica
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
