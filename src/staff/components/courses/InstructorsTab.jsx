import React, { useMemo, useState } from "react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { useConfirm } from "@/ui/ConfirmDialog";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { Label } from "@/ui/primitivi/label";
import { Input } from "@/ui/primitivi/input";
import { Textarea } from "@/ui/primitivi/textarea";
import { EmptyState } from "@/ui/StateViews";
import { Plus, Pencil, Trash2, Power, PowerOff, UserCog } from "lucide-react";
import { useToast } from "@/ui/primitivi/use-toast";
import {
  codiceFiscaleValido, normalizzaCodiceFiscale, partitaIvaValida, NOTE_ISTRUTTORE_MASSIMO,
} from "@/core/domain/anagrafica";

const MODULO_VUOTO = {
  nome: "", cognome: "", codice_fiscale: "", partita_iva: "", contact_email: "", contact_phone: "", notes: "",
};

/**
 * Gli istruttori: chi tiene i corsi.
 *
 * Si aggiungono e si modificano da una finestra, come corsi e sale: il modulo sempre aperto in
 * cima alla pagina spingeva l'elenco in basso, e chi apriva la pagina per cercare un nome
 * trovava prima un modulo vuoto.
 *
 * La tile dice chi è e le sue note, e nient'altro: altezza fissa, note in tre righe, così una
 * nota lunga non allunga la sua tile né sposta le altre. Codice fiscale, partita IVA e
 * recapiti stanno nella finestra.
 *
 * Si elimina finché nessun corso lo cita; dopo si disattiva, e sparisce dalle scelte.
 */
export default function InstructorsTab({ data, reload }) {
  const { instructors, courses } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(MODULO_VUOTO);
  const [salvando, setSalvando] = useState(false);

  // I disattivati in fondo: si consultano, ma non sono quelli con cui si lavora.
  const elenco = useMemo(() => [...instructors].sort((a, b) =>
    Number(b.attivo !== false) - Number(a.attivo !== false)
      || `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, "it", { sensitivity: "base" })
  ), [instructors]);

  const apriCreazione = () => {
    setEditing(null);
    setForm(MODULO_VUOTO);
    setShowForm(true);
  };

  const apriModifica = (istruttore) => {
    setEditing(istruttore);
    setForm({
      nome: istruttore.nome || "",
      cognome: istruttore.cognome || "",
      codice_fiscale: istruttore.codice_fiscale || "",
      partita_iva: istruttore.partita_iva || "",
      contact_email: istruttore.contact_email || "",
      contact_phone: istruttore.contact_phone || "",
      notes: istruttore.notes || "",
    });
    setShowForm(true);
  };

  const imposta = (campo) => (e) => {
    const valore = e.target.value;
    setForm((f) => ({ ...f, [campo]: valore }));
  };

  // Gli errori di battitura si vedono prima di salvare; il server li ricontrolla comunque.
  const cfScritto = form.codice_fiscale.trim();
  const cfNonValido = cfScritto.length > 0 && !codiceFiscaleValido(cfScritto);
  const pivaScritta = form.partita_iva.trim();
  const pivaNonValida = pivaScritta.length > 0 && !partitaIvaValida(pivaScritta);
  const moduloCompleto = form.nome.trim() && form.cognome.trim() && cfScritto && !cfNonValido && !pivaNonValida;

  const salva = async (e) => {
    e.preventDefault();
    if (!moduloCompleto) return;
    const payload = {
      nome: form.nome.trim(),
      cognome: form.cognome.trim(),
      codice_fiscale: normalizzaCodiceFiscale(cfScritto),
      partita_iva: pivaScritta || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      notes: form.notes.trim() || null,
    };
    setSalvando(true);
    try {
      if (editing) {
        await api.entities.Instructor.update(editing.id, payload);
        toast({ title: "Istruttore aggiornato" });
      } else {
        await api.entities.Instructor.create(payload);
        toast({ title: "Istruttore creato" });
      }
      setShowForm(false);
      setForm(MODULO_VUOTO);
      reload();
    } catch (err) {
      toast({ title: "Istruttore non salvato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  // Chi ha uno storico non si elimina: si disattiva, e sparisce dalle scelte per il futuro.
  const cambiaAttivo = async (istruttore, attivo) => {
    try {
      await api.entities.Instructor.update(istruttore.id, { attivo });
      toast({ title: attivo ? "Istruttore riattivato" : "Istruttore disattivato" });
      reload();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
  };

  // Un istruttore si elimina finché nessun corso lo cita: dopo, il corso resterebbe senza chi
  // lo tiene, e il calendario passato senza il nome di chi c'era.
  const elimina = async (istruttore) => {
    const suoi = courses.filter((c) => c.instructor_id === istruttore.id).length;
    if (suoi) {
      toast({
        title: "Questo istruttore non si può eliminare",
        description: `Tiene ${suoi} ${suoi === 1 ? "corso" : "corsi"}: assegnali a un altro istruttore, oppure disattivalo — resta nello storico e non si propone più.`,
        variant: "destructive",
      });
      return;
    }
    const ok = await conferma({ title: `Eliminare «${istruttore.full_name}»?`, confirmLabel: "Elimina", destructive: true });
    if (!ok) return;
    try {
      await api.entities.Instructor.delete(istruttore.id);
      toast({ title: "Istruttore eliminato" });
      reload();
    } catch (err) {
      toast({ title: "Non è stato possibile eliminare", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {dialogoConferma}
      {puoModificare && (
        <Button size="sm" onClick={apriCreazione}><Plus className="w-4 h-4 mr-1" /> Nuovo istruttore</Button>
      )}

      {instructors.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="Nessun istruttore"
          description="Chi tiene le lezioni. Un corso ha sempre un istruttore: registralo qui, poi crea il corso."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {elenco.map((i) => {
            const disattivato = i.attivo === false;
            return (
              // Altezza fissa, note sempre in tre righe piene o vuote: la griglia non balla.
              <Card key={i.id} className={`border-0 shadow-sm h-[148px] ${disattivato ? "opacity-60" : ""}`}>
                <CardContent className="p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-heading font-semibold truncate" title={i.full_name}>{i.full_name}</h3>
                      {disattivato && <p className="text-xs text-muted-foreground">Disattivato</p>}
                    </div>
                    {puoModificare && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifica ${i.full_name}`} onClick={() => apriModifica(i)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          title={disattivato ? "Riattiva" : "Disattiva"}
                          aria-label={`${disattivato ? "Riattiva" : "Disattiva"} ${i.full_name}`}
                          onClick={() => cambiaAttivo(i, disattivato)}
                        >
                          {disattivato ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Elimina ${i.full_name}`} onClick={() => elimina(i)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-auto line-clamp-3 break-words leading-5 h-[60px] overflow-hidden" title={i.notes || undefined}>
                    {i.notes}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica istruttore" : "Nuovo istruttore"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={salva} className="space-y-3">
            {editing && !editing.codice_fiscale && (
              <p className="text-sm rounded-lg bg-warning/10 px-3 py-2">
                Questo istruttore è stato registrato senza codice fiscale: per salvare va completato.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="istruttore-nome">Nome *</Label>
                <Input id="istruttore-nome" required maxLength={120} value={form.nome} onChange={imposta("nome")} />
              </div>
              <div>
                <Label htmlFor="istruttore-cognome">Cognome *</Label>
                <Input id="istruttore-cognome" required maxLength={120} value={form.cognome} onChange={imposta("cognome")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="istruttore-cf">Codice fiscale *</Label>
                <Input
                  id="istruttore-cf" required maxLength={16} autoCapitalize="characters" className="uppercase"
                  value={form.codice_fiscale} onChange={imposta("codice_fiscale")} aria-invalid={cfNonValido}
                />
                {cfNonValido && <p className="text-xs text-destructive mt-1">Codice fiscale non valido.</p>}
              </div>
              <div>
                <Label htmlFor="istruttore-piva">Partita IVA</Label>
                <Input
                  id="istruttore-piva" inputMode="numeric" maxLength={13}
                  value={form.partita_iva} onChange={imposta("partita_iva")} aria-invalid={pivaNonValida}
                />
                {pivaNonValida && <p className="text-xs text-destructive mt-1">Partita IVA non valida.</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="istruttore-email">Email</Label>
                <Input id="istruttore-email" type="email" value={form.contact_email} onChange={imposta("contact_email")} />
              </div>
              <div>
                <Label htmlFor="istruttore-telefono">Telefono</Label>
                <Input id="istruttore-telefono" value={form.contact_phone} onChange={imposta("contact_phone")} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="istruttore-note">Note</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{form.notes.length}/{NOTE_ISTRUTTORE_MASSIMO}</span>
              </div>
              <Textarea
                id="istruttore-note" rows={3} maxLength={NOTE_ISTRUTTORE_MASSIMO} className="resize-none"
                value={form.notes} onChange={imposta("notes")}
              />
            </div>
            <Button type="submit" className="w-full" disabled={!moduloCompleto || salvando}>
              {salvando ? "Salvataggio..." : editing ? "Salva istruttore" : "Crea istruttore"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
