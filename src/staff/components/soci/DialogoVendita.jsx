import React, { useEffect, useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatData, formatEuro } from "@/core/domain/format";
import { dataFineAbbonamento, descriviDurata, motivoNonVendibile, oggiIso } from "@/core/domain/abbonamenti";

/**
 * «Vendi un abbonamento»: il tipo dal listino e il giorno d'inizio. La stessa finestra nella
 * scheda del socio e in Da fare (Rinnova), già compilata da chi la apre: quasi sempre è un
 * rinnovo, lo stesso tipo di prima dal giorno dopo la fine.
 *
 * Scadenza e nome del tipo li fissa il server dalla durata del tipo: qui si mostrano soltanto.
 *
 * @param socioId  il socio a cui si vende
 * @param proposta { plan_id, start_date } quando la finestra è aperta, null quando è chiusa
 * @param piani    i tipi in vendita oggi; senza, li legge la finestra quando si apre
 * @param onFatto  dopo la vendita
 */
export default function DialogoVendita({ socioId, proposta, piani: pianiDati, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [modulo, setModulo] = useState({ plan_id: "", start_date: oggiIso() });
  const [letti, setLetti] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const aperta = Boolean(proposta);
  const piani = pianiDati ?? letti ?? [];

  useEffect(() => {
    if (proposta) setModulo({ plan_id: proposta.plan_id ?? "", start_date: proposta.start_date ?? oggiIso() });
  }, [proposta]);

  // Fuori dalla scheda il listino non c'è: lo si legge all'apertura. Si propongono solo i tipi
  // che si possono vendere oggi; il server lo ricontrolla.
  useEffect(() => {
    if (!aperta || pianiDati) return undefined;
    let vivo = true;
    api.entities.Plan.list()
      .then((p) => { if (vivo) setLetti(p.filter((pl) => !motivoNonVendibile(pl))); })
      .catch((err) => { if (vivo) { setLetti([]); toast({ title: "Listino non caricato", description: err.message, variant: "destructive" }); } });
    return () => { vivo = false; };
  }, [aperta, pianiDati]);

  const pianoScelto = piani.find((p) => p.id === modulo.plan_id);
  const scadenzaProposta = pianoScelto ? dataFineAbbonamento(modulo.start_date, pianoScelto.durata_valore, pianoScelto.durata_unita) : null;
  const caricando = aperta && !pianiDati && letti === null;

  const vendi = async (e) => {
    e.preventDefault();
    if (!pianoScelto) return;
    setSalvando(true);
    try {
      await api.entities.Subscription.create({
        member_id: socioId, plan_id: pianoScelto.id, start_date: modulo.start_date, status: "active", price_paid: pianoScelto.price,
      });
      toast({ title: "Abbonamento venduto" });
      onChiudi();
      onFatto?.();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aperta} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Vendi un abbonamento</DialogTitle></DialogHeader>
        <form onSubmit={vendi} className="space-y-3">
          <div>
            <Label>Tipo, dal listino *</Label>
            {/* Un tipo proposto che non è più in vendita non si mostra come scelto. */}
            <Select value={pianoScelto ? modulo.plan_id : ""} onValueChange={(v) => setModulo({ ...modulo, plan_id: v })}>
              <SelectTrigger><SelectValue placeholder={caricando ? "Caricamento del listino..." : "Scegli un tipo"} /></SelectTrigger>
              <SelectContent>
                {piani.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} — {descriviDurata(p.durata_valore, p.durata_unita)} — {formatEuro(p.price)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Data inizio abbonamento</Label><Input type="date" value={modulo.start_date} onChange={(e) => setModulo({ ...modulo, start_date: e.target.value })} /></div>
          {scadenzaProposta && <p className="text-xs text-muted-foreground">Valido fino al {formatData(scadenzaProposta, "lungo")} compreso.</p>}
          {aperta && !caricando && piani.length === 0 && <p className="text-xs text-muted-foreground">Nessun tipo in vendita: controlla stato e data massima nel listino.</p>}
          <Button type="submit" className="w-full" disabled={!pianoScelto || salvando}>
            {salvando ? "Vendita..." : "Vendi"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
