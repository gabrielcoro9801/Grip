import React, { useEffect, useMemo, useState } from "react";
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
  STATI_SALA, NOME_MASSIMO, NOTE_MASSIMO, ETICHETTA_STATO_SALA, SALA_PRENOTATA, SALA_GIA_ANNULLATA,
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

// La finestra da mostrare per ogni rifiuto del server, riconosciuto dal suo codice e non dal
// testo: prima si cercavano parole come "sospendere" nel messaggio, e bastava riformularlo per
// perdere la finestra senza nessun errore.
const TITOLO_RIFIUTO = {
  sala_prenotata: "Sala prenotata",
  sala_non_sospendibile: "Sala non sospendibile",
  sala_da_annullare: "Sala da annullare",
  sala_gia_annullata: "Niente da fare",
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
    const staAnnullando = editing && form.stato === "annullato" && editing.stato !== "annullato";
    if (staAnnullando && calendarioDi(editing.id).occupataDaQui) {
      setBloccata({ titolo: "Sala prenotata", testo: SALA_PRENOTATA });
      return;
    }
    // Annullare è definitivo, e dal cestino lo si conferma: dal menu dello stato valeva lo
    // stesso, ma partiva al primo "Salva".
    if (staAnnullando) {
      const ok = await conferma({
        title: `Annullare la sala «${editing.name}»?`,
        description: "Non ci si potrà più programmare niente, e non si potrà riattivare.",
        confirmLabel: "Annulla definitivamente",
        cancelLabel: "Lascia com'è",
        destructive: true,
      });
      if (!ok) return;
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
      if (TITOLO_RIFIUTO[err.code]) setBloccata({ titolo: TITOLO_RIFIUTO[err.code], testo: err.message });
      else toast({ title: "Sala non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  /**
   * Quanto è usata ogni sala, contato dal server sull'intero calendario.
   *
   * Prima il conto si faceva qui, sugli elenchi della pagina: che sono troncati (le lezioni da
   * tre mesi fa in avanti), e una sala con un passato più vecchio risultava mai usata — la
   * conferma prometteva un'eliminazione che il server poi rifiutava. Si richiede quando il
   * calendario cambia, cioè dopo ogni `reload`.
   */
  const [uso, setUso] = useState(null);
  useEffect(() => {
    let vivo = true;
    api.sale.uso().then((u) => { if (vivo) setUso(u); }).catch(() => { if (vivo) setUso(null); });
    return () => { vivo = false; };
  }, [rooms, events, sessions]);

  const calendarioDi = (roomId) => {
    const u = uso?.[roomId];
    return u ? { eventi: u.eventi, lezioni: u.lezioni, occupataDaQui: u.occupata_da_qui } : { eventi: 0, lezioni: 0, occupataDaQui: false };
  };

  /** Cosa fa il cestino su questa sala: elimina davvero, annulla, o niente. Senza il conto, niente. */
  const azioneDi = (room) => {
    if (!uso) return "niente";
    const { eventi, lezioni, occupataDaQui } = calendarioDi(room.id);
    return azioneSullaSala({ maiUsata: !eventi && !lezioni, occupataDaQui, annullata: room.stato === "annullato" });
  };

  /** Perché il cestino non fa niente: prenotata da qui in avanti, già annullata, o conto non pronto. */
  const motivoNiente = (room) => {
    if (!uso) return "Sto contando le lezioni della sala: riprova fra un istante.";
    return calendarioDi(room.id).occupataDaQui ? SALA_PRENOTATA : SALA_GIA_ANNULLATA;
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
      const occupata = calendarioDi(room.id).occupataDaQui;
      setBloccata({ titolo: occupata ? "Sala prenotata" : "Niente da fare", testo: motivoNiente(room) });
      return;
    }
    const { eventi, lezioni } = calendarioDi(room.id);
    const annulla = azione === "annulla";
    const ok = await conferma(annulla ? {
      title: `Annullare la sala «${room.name}»?`,
      description: `${messaggioAnnullaInveceDiEliminare(room.name, { eventi, lezioni })} È definitivo: non si potrà riattivare.`,
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
      if (TITOLO_RIFIUTO[err.code]) setBloccata({ titolo: TITOLO_RIFIUTO[err.code], testo: err.message });
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
                      {/* Grigio quando non c'è niente da fare: un pulsante che non si può usare deve
                          *sembrare* non usabile. Ma non `disabled`: il pulsante spento ignora il
                          puntatore, e né il titolo né la finestra col motivo comparivano mai.
                          `aria-disabled` lo dice agli screen reader, e il clic spiega perché. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-disabled={azione === "niente"}
                        className={`h-8 w-8 ${azione === "niente" ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive"}`}
                        aria-label={azione === "annulla" ? `Annulla ${room.name}` : `Elimina ${room.name}`}
                        title={azione === "niente" ? motivoNiente(room) : undefined}
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
                  <div className="mt-1 text-xs text-muted-foreground">
                    {uso ? `${calendarioDi(room.id).eventi} eventi assegnati` : " "}
                  </div>
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
                  {/* Una sala nuova non nasce annullata: sarebbe inutilizzabile per sempre dal
                      primo istante. */}
                  {STATI_SALA
                    .filter((s) => editing || s.valore !== "annullato")
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
