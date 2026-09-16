import React from "react";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { FONTI_LEAD } from "@/core/domain/lead";

// Radix non accetta un valore vuoto per una voce: "nessun corso" ha bisogno di un nome.
const NESSUN_CORSO = "nessuno";

export const LEAD_VUOTO = {
  full_name: "",
  phone: "",
  email: "",
  fonte: "passaggio",
  fonte_dettaglio: "",
  corso_interesse_id: "",
  obiettivo: "",
  note: "",
  prossima_azione_il: "",
  prossima_azione_nota: "",
  consenso_privacy: false,
  consenso_marketing: false,
};

/** Solo i campi che il modulo modifica, a partire da un lead letto dall'API. */
export function modificabili(lead) {
  return Object.fromEntries(Object.keys(LEAD_VUOTO).map((k) => [k, lead?.[k] ?? LEAD_VUOTO[k]]));
}

/**
 * I campi di un lead, gli stessi quando lo si crea al banco e quando lo si corregge.
 *
 * `compatto` lascia fuori quello che al primo contatto non si sa ancora o non serve: chi
 * entra a chiedere un prezzo va registrato in venti secondi, non in due minuti.
 */
export default function CampiLead({ valori, onChange, corsi, compatto = false }) {
  const imposta = (campo) => (e) => onChange({ ...valori, [campo]: e?.target ? e.target.value : e });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="lead-nome">Nome e cognome *</Label>
        <Input id="lead-nome" required value={valori.full_name} onChange={imposta("full_name")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="lead-telefono">Telefono</Label>
          <Input id="lead-telefono" type="tel" value={valori.phone} onChange={imposta("phone")} />
        </div>
        <div>
          <Label htmlFor="lead-email">Email</Label>
          <Input id="lead-email" type="email" value={valori.email} onChange={imposta("email")} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Come ci ha conosciuto</Label>
          <Select value={valori.fonte} onValueChange={imposta("fonte")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FONTI_LEAD.map((f) => <SelectItem key={f.valore} value={f.valore}>{f.etichetta}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Corso di interesse</Label>
          <Select
            value={valori.corso_interesse_id || NESSUN_CORSO}
            onValueChange={(v) => onChange({ ...valori, corso_interesse_id: v === NESSUN_CORSO ? "" : v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NESSUN_CORSO}>Non ancora deciso</SelectItem>
              {corsi.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!compatto && (
        <div>
          <Label htmlFor="lead-fonte-dettaglio">Dettaglio della fonte</Label>
          <Input
            id="lead-fonte-dettaglio"
            placeholder="Es. presentato da Marco Rossi, post del 12 settembre"
            value={valori.fonte_dettaglio}
            onChange={imposta("fonte_dettaglio")}
          />
        </div>
      )}
      <div>
        <Label htmlFor="lead-obiettivo">Cosa cerca</Label>
        <Input id="lead-obiettivo" placeholder="Es. tornare in forma dopo l'estate" value={valori.obiettivo} onChange={imposta("obiettivo")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
        <div>
          <Label htmlFor="lead-azione-data">Da ricontattare il</Label>
          <Input id="lead-azione-data" type="date" value={valori.prossima_azione_il ?? ""} onChange={imposta("prossima_azione_il")} />
        </div>
        <div>
          <Label htmlFor="lead-azione-nota">Per cosa</Label>
          <Input id="lead-azione-nota" placeholder="Es. richiamare per l'orario del sabato" value={valori.prossima_azione_nota} onChange={imposta("prossima_azione_nota")} />
        </div>
      </div>
      {!compatto && (
        <div>
          <Label htmlFor="lead-note">Note</Label>
          <Textarea id="lead-note" rows={3} value={valori.note} onChange={imposta("note")} />
        </div>
      )}
      <div className="space-y-2 pt-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={valori.consenso_privacy} onCheckedChange={(v) => onChange({ ...valori, consenso_privacy: v === true })} />
          <span>Consenso al trattamento dei dati per essere ricontattato</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={valori.consenso_marketing} onCheckedChange={(v) => onChange({ ...valori, consenso_marketing: v === true })} />
          <span>Consenso a ricevere comunicazioni promozionali</span>
        </label>
      </div>
    </div>
  );
}
