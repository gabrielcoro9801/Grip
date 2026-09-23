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
import { useConfirm } from "@/ui/ConfirmDialog";
import { Plus, Pencil, Trash2, CalendarOff, DoorOpen, AlertTriangle } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import {
  STATI_SALA, NOME_MASSIMO, NOTE_MASSIMO, ETICHETTA_STATO_SALA, SALA_PRENOTATA,
  statoSala, descriviSospensione, motivoSospensioneNonValida, motivoCambioStatoNonValido,
  azioneSullaSala, messaggioAnnullaInveceDiEliminare, dataIt, oggiIso,
} from "@/core/domain/sale";

const MODULO_VUOTO = { name: "", stato: "attivo", sospesa_dal: "", sospesa_al: "", description: "" };

// Cosa vuol dire ogni stato, detto a chi lo sceglie.
const SPIEGAZIONE_STATO = {
  attivo: "La sala si può usare: compare quando si programma un evento.",
  sospeso: "Nel periodo indicato la sala non si può usare, e non si programmano lezioni.",
  annullato: "La sala non si usa più, e non ci si programma niente. È definitivo: non si può riattivare.",
};

const ORDINE_STATO = { attiva: 0, programmata: 1, conclusa: 2, sospesa: 3, annullata: 4 };

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
 * Sospesa è sempre un periodo, da data a data. Annullata è per sempre. E comandano gli eventi:
 * finché ci sono lezioni in calendario, la stanza non si chiude e non si toglie di mezzo —
 * i soci ci sono già prenotati sopra.
 *
 * Il pulsante di eliminazione fa una cosa diversa a seconda di quanto la sala è stata usata, e
 * la regola è quanto si perderebbe: una sala mai collegata a un evento si elimina; una che ha
 * ospitato lezioni passate si annulla, perché cancellarla toglierebbe il «dove» a un pezzo di
 * calendario accaduto; una con lezioni da qui in avanti non si tocca. Il conto arriva dagli
 * elenchi già in pagina (`azioneSullaSala`), e il server rifà lo stesso conto per conto suo.
 */
export default function RoomsTab({ data, reload }) {
  const { rooms, events, sessions } = data;
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(MODULO_VUOTO);
  const [salvando, setSalvando] = useState(false);
  // Il rifiuto: una sala che non si può sospendere, o eliminare, perché è ancora occupata.
  const [bloccata, setBloccata] = useState(null);

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
    // Annullare dal menu è la stessa cosa che premere il cestino, e va a sbattere sulla stessa
    // regola: finché la sala è in calendario da qui in avanti, non si annulla. Il conto è già in
    // pagina, quindi la risposta arriva al salvataggio senza andare fino al server — che la
    // ripete comunque, perché è lui a conoscere il calendario di adesso.
    if (editing && form.stato === "annullato" && calendarioDi(editing.id).occupataDaQui) {
      setBloccata({ titolo: "Sala prenotata", testo: SALA_PRENOTATA });
      return;
    }
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
      // I rifiuti che dipendono dal calendario hanno una finestra loro: sono cose da leggere e da
      // capire — cosa c'è nel modo, e cosa fare prima — non avvisi che scompaiono da soli dopo
      // tre secondi.
      if (err.message === SALA_PRENOTATA) setBloccata({ titolo: "Sala prenotata", testo: err.message });
      else if (sospesa && /sospendere/.test(err.message)) setBloccata({ titolo: "Sala non sospendibile", testo: err.message });
      else toast({ title: "Sala non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const quantiEventi = (roomId) => events.filter(e => e.room_id === roomId).length;

  /**
   * Il calendario di ogni sala, letto una volta sola per tutte.
   *
   * Tre domande per sala su due elenchi: con un filtro per tile si finisce a scorrere gli stessi
   * cinquecento eventi una volta per riga. Qui si scorrono una volta e basta.
   *
   * `occupataDaQui` non conta le lezioni cancellate — nessuno ci va — e tiene buoni gli eventi
   * che partono in futuro anche senza sessioni generate, che è come nascono se qualcuno li crea
   * dall'API senza passare dal modulo.
   */
  const calendarioPerSala = useMemo(() => {
    const per = new Map(rooms.map(r => [r.id, { eventi: 0, lezioni: 0, occupataDaQui: false }]));
    for (const e of events) {
      const riga = per.get(e.room_id);
      if (!riga) continue;
      riga.eventi += 1;
      if (e.start_date >= oggi) riga.occupataDaQui = true;
    }
    for (const s of sessions) {
      const riga = per.get(s.room_id);
      if (!riga) continue;
      riga.lezioni += 1;
      if (s.status !== "cancelled" && s.date >= oggi) riga.occupataDaQui = true;
    }
    return per;
  }, [rooms, events, sessions, oggi]);

  const calendarioDi = (roomId) => calendarioPerSala.get(roomId) ?? { eventi: 0, lezioni: 0, occupataDaQui: false };

  /** Cosa fa il cestino su questa sala: elimina davvero, annulla, o è spento. */
  const azioneDi = (room) => {
    const { eventi, lezioni, occupataDaQui } = calendarioDi(room.id);
    return azioneSullaSala({ maiUsata: !eventi && !lezioni, occupataDaQui });
  };

  /**
   * Il cestino, che fa due cose diverse e ne dice una terza.
   *
   * Su una sala mai usata elimina. Su una che ha ospitato lezioni passate annulla — la stessa
   * intenzione, eseguita nel modo che non cancella il calendario di chi ci si è allenato — e la
   * conferma lo dice prima, perché premere "elimina" e ottenere un annullamento sarebbe una
   * sorpresa anche quando è la cosa giusta. Su una sala con lezioni da qui in avanti il pulsante
   * è spento: non c'è niente da chiedere.
   *
   * Il conto è già in pagina, quindi la risposta arriva subito; il server lo rifà comunque,
   * perché una pagina aperta da un'ora conosce il calendario di un'ora fa.
   */
  const eliminaOAnnulla = async (room) => {
    const azione = azioneDi(room);
    if (azione === "niente") {
      setBloccata({ titolo: "Sala prenotata", testo: SALA_PRENOTATA });
      return;
    }
    const { eventi, lezioni } = calendarioDi(room.id);
    const annulla = azione === "annulla";
    const ok = await conferma(annulla ? {
      title: `Annullare la sala «${room.name}»?`,
      description: `${messaggioAnnullaInveceDiEliminare(room.name, eventi || lezioni)} È definitivo: non si potrà riattivare.`,
      confirmLabel: "Annulla definitivamente",
      cancelLabel: "Lascia com'è",
      destructive: true,
    } : {
      title: `Eliminare la sala «${room.name}»?`,
      description: "Non è mai stata collegata a un evento, quindi si può eliminare davvero. Non si recupera.",
      confirmLabel: "Elimina",
      cancelLabel: "Non eliminare",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (annulla) {
        await api.entities.Room.update(room.id, { stato: "annullato", sospesa_dal: null, sospesa_al: null });
        toast({ title: "Sala annullata" });
      } else {
        await api.entities.Room.delete(room.id);
        toast({ title: "Sala eliminata" });
      }
      reload();
    } catch (err) {
      // Il calendario è cambiato sotto i piedi da quando la pagina è stata caricata: il server
      // ha l'ultima parola, e la sua risposta va letta, non fatta sparire dopo tre secondi.
      if (err.message === SALA_PRENOTATA) setBloccata({ titolo: "Sala prenotata", testo: err.message });
      else if (/non si elimina/.test(err.message)) setBloccata({ titolo: "Sala da annullare", testo: err.message });
      else toast({ title: annulla ? "Sala non annullata" : "Sala non eliminata", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {dialogoConferma}
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
            const azione = azioneDi(room);
            return (
              // Altezza e righe fisse: le note occupano sempre due righe, piene o vuote, così una
              // nota lunga non allunga la sua tile né sposta le altre.
              <Card key={room.id} className={`border-0 shadow-sm h-[168px] ${stato === "sospesa" ? "opacity-70" : ""} ${stato === "annullata" ? "opacity-60" : ""}`}>
                <CardContent className="p-5 h-full flex flex-col">
                  {/* Il distintivo sta sulla riga sotto e non accanto al nome: "Sospensione
                      programmata" più due pulsanti riempiono una tile stretta, e a rimetterci
                      sarebbe il nome — l'unica cosa per cui si guarda una tile. */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-heading font-semibold truncate" title={room.name}>{room.name}</h3>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Modifica ${room.name}`}
                        onClick={() => apriModifica(room)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {/* Spento e grigio quando la sala è prenotata da qui in avanti: un pulsante
                          che non si può premere deve *sembrare* non premibile, altrimenti si
                          clicca tre volte prima di sospettare che sia lui. Il titolo dice perché,
                          per chi ci passa sopra. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={azione === "niente"}
                        className={`h-8 w-8 ${azione === "niente" ? "text-muted-foreground" : "text-destructive"}`}
                        aria-label={azione === "annulla" ? `Annulla ${room.name}` : `Elimina ${room.name}`}
                        title={azione === "niente" ? SALA_PRENOTATA : undefined}
                        onClick={() => eliminaOAnnulla(room)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 min-w-0">
                    <StatusBadge status={stato} label={etichetta} tone={tono} className="flex-shrink-0" />
                    {room.stato === "sospeso" && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate" title={descriviSospensione(room)}>
                        <CalendarOff className="w-3 h-3 shrink-0" /> dal {dataIt(room.sospesa_dal)} al {dataIt(room.sospesa_al)}
                      </span>
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
              <div className="flex items-baseline justify-between">
                <Label htmlFor="sala-nome">Nome *</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{form.name.length}/{NOME_MASSIMO}</span>
              </div>
              <Input id="sala-nome" required maxLength={NOME_MASSIMO} value={form.name} onChange={imposta("name")} />
            </div>
            <div>
              <Label>Stato</Label>
              {/* Una sala annullata non ha altri stati fra cui scegliere: è definitivo, e
                  mostrare "Attiva" in un menu che poi il server rifiuta sarebbe una promessa. */}
              <Select value={form.stato} onValueChange={(stato) => setForm((f) => ({ ...f, stato }))}>
                <SelectTrigger aria-label="Stato della sala"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATI_SALA
                    .filter((s) => !motivoCambioStatoNonValido(editing?.stato ?? "attivo", s.valore))
                    .map((s) => <SelectItem key={s.valore} value={s.valore}>{s.etichetta}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className={`text-xs mt-1 ${form.stato === "annullato" ? "text-destructive" : "text-muted-foreground"}`}>
                {SPIEGAZIONE_STATO[form.stato]}
              </p>
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

      {/* Comandano gli eventi: la sala non si chiude, e non sparisce, sotto le lezioni già fissate. */}
      <Dialog open={!!bloccata} onOpenChange={(aperta) => !aperta && setBloccata(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" /> {bloccata?.titolo}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{bloccata?.testo}</p>
          <Button className="w-full" onClick={() => setBloccata(null)}>Ho capito</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
