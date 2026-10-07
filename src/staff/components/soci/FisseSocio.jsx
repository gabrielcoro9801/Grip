import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { DAYS, DAYS_IT } from "@/staff/lib/courseValidation";
import { fineEvento, giorniInOrdine, elencoGiorni, hhmm } from "@/staff/lib/modificaEvento";
import { oggiIso } from "@/core/domain/giorni";
import { Plus, Repeat } from "lucide-react";

/**
 * Le prenotazioni fisse di un socio, nella sua scheda: quelle attive, aggiungerne una per suo
 * conto (la serie e i giorni), terminarla. Le lezioni le prenota il server con le regole di
 * sempre: capienza, lista d'attesa, abbonamento valido quel giorno.
 */
export default function FisseSocio({ socio, puoModificare }) {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [fisse, setFisse] = useState(null);
  const [serie, setSerie] = useState([]);
  const [modulo, setModulo] = useState(null); // { event_id, giorni }
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(() => {
    api.prenotazioniFisse.elenco({ member_id: socio.id }).then((r) => setFisse(r.fisse)).catch(() => setFisse([]));
  }, [socio.id]);
  useEffect(() => { carica(); }, [carica]);

  // Le serie che si possono prenotare fisse: settimanali o a date scelte, non ancora finite.
  const apri = async () => {
    const oggi = oggiIso();
    const [eventi, corsi] = await Promise.all([api.entities.Event.list(), api.entities.Course.list()]);
    const nome = new Map(corsi.map((c) => [c.id, c.name]));
    setSerie(eventi
      .filter((e) => (e.recurrence_type === "weekly" || e.recurrence_type === "custom") && (fineEvento(e) ?? "9999") >= oggi)
      .map((e) => ({ ...e, nome: nome.get(e.course_id) ?? "Corso" }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "it")));
    setModulo({ event_id: "", giorni: [] });
  };

  const scelta = useMemo(() => serie.find((s) => s.id === modulo?.event_id), [serie, modulo]);

  const salva = async () => {
    setSalvando(true);
    try {
      const esito = await api.prenotazioniFisse.crea({ member_id: socio.id, event_id: modulo.event_id, giorni: modulo.giorni });
      const parti = [`${esito.prenotate} prenotate`];
      if (esito.in_attesa) parti.push(`${esito.in_attesa} in lista d'attesa`);
      if (esito.senza_abbonamento) parti.push(`${esito.senza_abbonamento} oltre l'abbonamento`);
      toast({ title: "Prenotazione fissa attivata", description: parti.join(", ") });
      setModulo(null);
      carica();
    } catch (err) {
      toast({ title: "Non attivata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const termina = async (f) => {
    const ok = await conferma({
      title: `Terminare la fissa di ${f.corso}?`,
      description: "Le prossime lezioni prenotate da questa fissa vengono disdette, e non se ne prenotano altre.",
      confirmLabel: "Termina",
      destructive: true,
    });
    if (!ok) return;
    try {
      const esito = await api.prenotazioniFisse.termina(f.id);
      toast({ title: "Prenotazione fissa terminata", description: `${esito.disdette} lezioni disdette` });
      carica();
    } catch (err) {
      toast({ title: "Non terminata", description: err.message, variant: "destructive" });
    }
  };

  const alterna = (g) => setModulo((m) => ({ ...m, giorni: m.giorni.includes(g) ? m.giorni.filter((x) => x !== g) : giorniInOrdine([...m.giorni, g]) }));

  return (
    <Card className="border-0 shadow-sm">
      {dialogoConferma}
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><Repeat className="w-4 h-4" /> Prenotazioni fisse</CardTitle>
        {puoModificare && !socio.archiviato_il && (
          <Button size="sm" variant="outline" className="h-8" onClick={apri}><Plus className="w-3 h-3 mr-1" /> Nuova</Button>
        )}
      </CardHeader>
      <CardContent>
        {fisse === null ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : fisse.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">Nessuna prenotazione fissa</p>
        ) : (
          <ul className="space-y-2">
            {fisse.map((f) => (
              <li key={f.id} className="p-3 rounded-lg bg-muted/50 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.corso}</p>
                  <p className="text-xs text-muted-foreground">
                    Ogni {elencoGiorni(f.giorni ?? f.giorni_serie ?? [])} · {hhmm(f.inizio)}–{hhmm(f.fine)}
                    {f.creata_da ? ` · attivata da ${f.creata_da}` : ""}
                  </p>
                </div>
                {puoModificare && <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => termina(f)}>Termina</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!modulo} onOpenChange={(v) => { if (!v && !salvando) setModulo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova prenotazione fissa</DialogTitle>
            <DialogDescription>{socio.full_name}: le lezioni si prenotano da sole finché ha un abbonamento valido.</DialogDescription>
          </DialogHeader>
          {modulo && (
            <div className="space-y-4">
              <div>
                <Label>Serie</Label>
                <Select value={modulo.event_id || undefined} onValueChange={(v) => setModulo({ event_id: v, giorni: giorniInOrdine(serie.find((s) => s.id === v)?.days_of_week) })}>
                  <SelectTrigger aria-label="Serie"><SelectValue placeholder="Scegli il corso" /></SelectTrigger>
                  <SelectContent>
                    {serie.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome} · {s.recurrence_type === "weekly" ? elencoGiorni(s.days_of_week) : "date scelte"} {hhmm(s.start_time)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {serie.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessuna serie in corso.</p>}
              </div>
              {scelta?.recurrence_type === "weekly" && (
                <div>
                  <Label>Giorni</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DAYS.filter((d) => (scelta.days_of_week || []).includes(d)).map((d) => (
                      <button
                        key={d} type="button" aria-pressed={modulo.giorni.includes(d)} onClick={() => alterna(d)}
                        className={`px-3 py-1.5 rounded-lg text-sm ${modulo.giorni.includes(d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {(DAYS_IT[d] || d).slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setModulo(null)} disabled={salvando}>Annulla</Button>
                <Button onClick={salva} disabled={salvando || !modulo.event_id || (scelta?.recurrence_type === "weekly" && modulo.giorni.length === 0)}>
                  {salvando ? "Attivazione..." : "Attiva"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
