import React, { useMemo, useState } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import StatusBadge from "@/ui/StatusBadge";
import { EmptyState } from "@/ui/StateViews";
import { Plus, Pencil, CalendarOff, DoorOpen, AlertTriangle } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import {
  STATI_SALA, NOTE_MASSIMO, ETICHETTA_STATO_SALA,
  statoSala, descriviSospensione, motivoSospensioneNonValida, oggiIso,
} from "@/core/domain/sale";

const MODULO_VUOTO = { name: "", stato: "attivo", sospesa_dal: "", sospesa_al: "", description: "" };

// Cosa vuol dire ogni stato, detto a chi lo sceglie.
const SPIEGAZIONE_STATO = {
  attivo: "La sala si può usare: compare quando si programma un evento.",
  sospeso: "Nel periodo indicato la sala non si può usare, e non si programmano lezioni.",
};

const ORDINE_STATO = { attiva: 0, programmata: 1, conclusa: 2, sospesa: 3 };

/**
 * Le sale: gli spazi in cui si tengono le lezioni.
 *
 * Una sala si modifica in tutti i suoi dati, nome compreso: nel database la identifica il suo
 * id, che eventi e sessioni citano, quindi cambiarle nome non stacca niente da niente.
 *
 * La capienza non c'è più. Quanta gente entra a lezione lo decide l'evento — nella stessa
 * stanza uno spinning e un pilates non tengono lo stesso numero di persone — e il numero
 * scritto sulla sala serviva solo da valore di partenza del modulo: due numeri per la stessa
 * cosa, di cui uno quasi sempre sbagliato.
 *
 * Sospesa è sempre un periodo, da data a data. E comandano gli eventi: se in quel periodo ci
 * sono lezioni già in calendario il server rifiuta, perché i soci ci sono già prenotati sopra.
 */
export default function RoomsTab({ data, reload }) {
  const { rooms, events } = data;
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(MODULO_VUOTO);
  const [salvando, setSalvando] = useState(false);
  // Il rifiuto del server: una sala che non si può sospendere perché è ancora occupata.
  const [bloccata, setBloccata] = useState("");

  const oggi = oggiIso();

  const ordinate = useMemo(() => [...rooms].sort((a, b) =>
    (ORDINE_STATO[statoSala(a, oggi)] ?? 9) - (ORDINE_STATO[statoSala(b, oggi)] ?? 9)
      || a.name.localeCompare(b.name, "it")
  ), [rooms, oggi]);

  const apriCreazione = () => {
    setEditing(null);
    setForm(MODULO_VUOTO);
    setShowForm(true);
  };

  const apriModifica = (room) => {
    setEditing(room);
    setForm({
      name: room.name || "",
      stato: room.stato || "attivo",
      sospesa_dal: room.sospesa_dal || "",
      sospesa_al: room.sospesa_al || "",
      description: room.description || "",
    });
    setShowForm(true);
  };

  const imposta = (campo) => (e) => {
    const valore = e.target.value;
    setForm((f) => ({ ...f, [campo]: valore }));
  };

  const motivoPeriodo = form.stato === "sospeso" ? motivoSospensioneNonValida(form.sospesa_dal, form.sospesa_al) : null;
  const moduloCompleto = form.name.trim() && !motivoPeriodo;

  const salva = async (e) => {
    e.preventDefault();
    const sospesa = form.stato === "sospeso";
    const payload = {
      name: form.name.trim(),
      stato: form.stato,
      sospesa_dal: sospesa ? form.sospesa_dal : null,
      sospesa_al: sospesa ? form.sospesa_al : null,
      description: form.description.trim() || null,
    };
    setSalvando(true);
    try {
      if (editing) {
        await api.entities.Room.update(editing.id, payload);
        toast({ title: "Sala aggiornata" });
      } else {
        await api.entities.Room.create(payload);
        toast({ title: "Sala creata" });
      }
      setShowForm(false);
      setForm(MODULO_VUOTO);
      reload();
    } catch (err) {
      // Il rifiuto della sospensione ha una finestra sua: è una cosa da leggere e da capire,
      // non un avviso che scompare da solo dopo tre secondi.
      if (sospesa && /sospendere/.test(err.message)) setBloccata(err.message);
      else toast({ title: "Sala non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const quantiEventi = (roomId) => events.filter(e => e.room_id === roomId).length;

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={apriCreazione}><Plus className="w-4 h-4 mr-1" /> Nuova sala</Button>

      {rooms.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="Nessuna sala"
          description="Le stanze in cui si tengono le lezioni. Un evento sceglie sempre una sala: senza, non si programma niente."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ordinate.map(room => {
            const stato = statoSala(room, oggi);
            const { etichetta, tono } = ETICHETTA_STATO_SALA[stato];
            return (
              // Altezza e righe fisse: le note occupano sempre due righe, piene o vuote, così una
              // nota lunga non allunga la sua tile né sposta le altre.
              <Card key={room.id} className={`border-0 shadow-sm h-[168px] ${stato === "sospesa" ? "opacity-70" : ""}`}>
                <CardContent className="p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-heading font-semibold truncate" title={room.name}>{room.name}</h3>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <StatusBadge status={stato} label={etichetta} tone={tono} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Modifica ${room.name}`}
                        onClick={() => apriModifica(room)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground h-4">
                    {room.stato === "sospeso" && (
                      <span className="flex items-center gap-1"><CalendarOff className="w-3 h-3 shrink-0" /> {descriviSospensione(room)}</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{quantiEventi(room.id)} eventi assegnati</div>
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2 break-words leading-5 h-10" title={room.description || undefined}>
                    {room.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica sala" : "Nuova sala"}</DialogTitle>
            {editing && <DialogDescription>Gli eventi restano dove sono: seguono la sala, non il suo nome.</DialogDescription>}
          </DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            <div>
              <Label htmlFor="sala-nome">Nome *</Label>
              <Input id="sala-nome" required maxLength={255} value={form.name} onChange={imposta("name")} />
            </div>
            <div>
              <Label>Stato</Label>
              <Select value={form.stato} onValueChange={(stato) => setForm((f) => ({ ...f, stato }))}>
                <SelectTrigger aria-label="Stato della sala"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATI_SALA.map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{SPIEGAZIONE_STATO[form.stato]}</p>
            </div>
            {form.stato === "sospeso" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="sala-dal">Sospesa dal *</Label>
                  <Input id="sala-dal" type="date" required value={form.sospesa_dal} onChange={imposta("sospesa_dal")} />
                </div>
                <div>
                  <Label htmlFor="sala-al">Fino al *</Label>
                  <Input id="sala-al" type="date" required min={form.sospesa_dal || undefined} value={form.sospesa_al} onChange={imposta("sospesa_al")} />
                </div>
              </div>
            )}
            {motivoPeriodo && form.sospesa_dal && form.sospesa_al && (
              <p className="text-xs text-destructive">{motivoPeriodo}</p>
            )}
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="sala-note">Note</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{form.description.length}/{NOTE_MASSIMO}</span>
              </div>
              <Textarea id="sala-note" rows={2} maxLength={NOTE_MASSIMO} value={form.description} onChange={imposta("description")} className="resize-none" />
            </div>
            <Button type="submit" className="w-full" disabled={!moduloCompleto || salvando}>
              {salvando ? "Salvataggio..." : editing ? "Salva sala" : "Crea sala"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Comandano gli eventi: la sala non si chiude sotto le lezioni già fissate. */}
      <Dialog open={!!bloccata} onOpenChange={(aperta) => !aperta && setBloccata("")}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" /> Sala non sospendibile
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{bloccata}</p>
          <Button className="w-full" onClick={() => setBloccata("")}>Ho capito</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
