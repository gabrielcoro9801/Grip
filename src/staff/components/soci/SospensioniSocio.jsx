import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatData } from "@/core/domain/format";
import { oggiIso, spostaGiorni, giorniFra } from "@/core/domain/giorni";
import { NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { PauseCircle } from "lucide-react";

/**
 * Nella scheda, sotto gli abbonamenti: le sospensioni in corso o in arrivo, e "Sospendi".
 *
 * Una sospensione ferma l'abbonamento fino alla ripresa: il socio non entra e non prenota, e la
 * scadenza slitta di altrettanto. Non si scrive la scadenza: la calcola il server, e gli
 * abbonamenti qui sopra la mostrano già allungata. Le passate restano nel diario.
 */
export default function SospensioniSocio({ socio, puoModificare, onCambio }) {
  const { toast } = useToast();
  const [elenco, setElenco] = useState([]);
  const [aperta, setAperta] = useState(false);
  const [valori, setValori] = useState({ dal: oggiIso(), riprende_il: spostaGiorni(oggiIso(), 14), nota: "" });
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(() => {
    api.soci.sospensioni(socio.id).then((r) => setElenco(r.sospensioni.filter((s) => s.stato !== "finita"))).catch(() => setElenco([]));
  }, [socio.id]);
  useEffect(() => { carica(); }, [carica]);

  const giorni = giorniFra(valori.dal, valori.riprende_il);
  const fatto = () => { carica(); onCambio?.(); };

  const sospendi = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { prenotazioni_disdette: disdette } = await api.soci.sospendi(socio.id, valori);
      toast({ title: "Abbonamento sospeso", description: `Riprende il ${formatData(valori.riprende_il, "media")}.${disdette ? ` Disdette ${disdette} prenotazioni di quei giorni.` : ""}` });
      setAperta(false);
      setValori({ dal: oggiIso(), riprende_il: spostaGiorni(oggiIso(), 14), nota: "" });
      fatto();
    } catch (err) {
      toast({ title: "Non sospeso", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const termina = async (s) => {
    try {
      await api.soci.terminaSospensione(socio.id, s.id);
      toast({ title: s.stato === "futura" ? "Sospensione annullata" : "Riprende da oggi" });
      fatto();
    } catch (err) {
      toast({ title: "Non modificata", description: err.message, variant: "destructive" });
    }
  };

  if (!elenco.length && (!puoModificare || socio.archiviato_il)) return null;
  return (
    <div className="mt-3 space-y-2">
      {elenco.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="flex items-start gap-2">
            <PauseCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              {s.stato === "in_corso" ? "Sospeso" : "Sarà sospeso"} dal {formatData(s.dal, "breve")}, riprende il {formatData(s.riprende_il, "breve")}
              {s.nota && <span className="block text-xs text-muted-foreground">{s.nota}</span>}
            </span>
          </span>
          {puoModificare && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => termina(s)}>
              {s.stato === "futura" ? "Annulla" : "Riprende oggi"}
            </Button>
          )}
        </div>
      ))}
      {puoModificare && !socio.archiviato_il && (
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setAperta(true)}>
          <PauseCircle className="w-3.5 h-3.5 mr-1" /> Sospendi abbonamento
        </Button>
      )}
      <Dialog open={aperta} onOpenChange={(v) => { if (!salvando) setAperta(v); }}>
        <DialogContent className="max-w-md">
          <form onSubmit={sospendi} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Sospendi l'abbonamento</DialogTitle>
              <DialogDescription>
                {socio.full_name} non entra e non prenota fino alla ripresa; la scadenza slitta di altrettanti giorni.
                Le prenotazioni di quei giorni vengono disdette.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sosp-dal">Dal</Label>
                <Input id="sosp-dal" type="date" min={oggiIso()} value={valori.dal} onChange={(e) => setValori((v) => ({ ...v, dal: e.target.value }))} required />
              </div>
              <div>
                <Label htmlFor="sosp-ripresa">Riprende il</Label>
                <Input id="sosp-ripresa" type="date" min={valori.dal ? spostaGiorni(valori.dal, 1) : undefined} value={valori.riprende_il} onChange={(e) => setValori((v) => ({ ...v, riprende_il: e.target.value }))} required />
              </div>
            </div>
            {giorni > 0 && <p className="text-sm text-muted-foreground">{giorni} {giorni === 1 ? "giorno" : "giorni"} di sospensione.</p>}
            <div>
              <Label htmlFor="sosp-nota">Motivo (facoltativo)</Label>
              <Textarea id="sosp-nota" rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none" placeholder="Es. infortunio al ginocchio, viaggio di lavoro"
                value={valori.nota} onChange={(e) => setValori((v) => ({ ...v, nota: e.target.value }))} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAperta(false)} disabled={salvando}>Annulla</Button>
              <Button type="submit" disabled={salvando || !(giorni > 0)}>{salvando ? "Salvataggio..." : "Sospendi"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
