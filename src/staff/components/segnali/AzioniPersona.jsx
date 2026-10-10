import React, { useState } from "react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import AzioneLead, { Scelte } from "@/staff/components/lead/AzioneLead";
import { CANALI_CONTATTO, ESITI_CONTATTO, NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { linkWhatsApp } from "@/core/domain/anagrafica";
import { testoMessaggio } from "@/core/domain/segnali";
import DialogoAbbandono from "@/staff/components/soci/DialogoAbbandono";
import { Phone, MessageCircle, Mail, Check, Clock, UserX } from "lucide-react";

const RIMANDI = [
  { giorni: 1, etichetta: "A domani" },
  { giorni: 3, etichetta: "Fra 3 giorni" },
  { giorni: 7, etichetta: "Fra una settimana" },
];
// Al telefono non si propone un rinnovo "salutando": gli esiti di persona li usa il bancone.
const ESITI_DA_STAFF = ESITI_CONTATTO.filter((e) => e.valore !== "salutato");

/** "Fatto, com'è andata": il contatto con un socio, nel suo diario. */
function DialogoContatto({ persona, aperto, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [valori, setValori] = useState({ canale: "telefono", esito: null, nota: "" });
  const [salvando, setSalvando] = useState(false);
  const imposta = (campo) => (v) => setValori((p) => ({ ...p, [campo]: v }));

  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.persone.contatto(persona.persona_id, valori);
      toast({ title: persona.nome, description: "Contatto registrato nel diario." });
      setValori({ canale: "telefono", esito: null, nota: "" });
      onFatto();
      onChiudi();
    } catch (err) {
      toast({ title: "Contatto non registrato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  return (
    <Dialog open={aperto} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-md">
        <form onSubmit={conferma} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Fatto: com'è andata?</DialogTitle>
            <DialogDescription>{persona.nome}{persona.perche ? ` · ${persona.perche}` : ""}</DialogDescription>
          </DialogHeader>
          <Scelte etichetta="Come" voci={CANALI_CONTATTO} valore={valori.canale} onScegli={imposta("canale")} />
          <Scelte etichetta="Com'è andata" voci={ESITI_DA_STAFF.map((x) => ({ ...x, etichetta: x.etichetta[0].toUpperCase() + x.etichetta.slice(1) }))} valore={valori.esito} onScegli={imposta("esito")} />
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="contatto-nota">Nota</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{valori.nota.length}/{NOTA_DIARIO_MASSIMO}</span>
            </div>
            <Textarea
              id="contatto-nota" rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none"
              placeholder="Es. rinnova sabato, vuole il trimestrale"
              value={valori.nota} onChange={(e) => imposta("nota")(e.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={onChiudi} disabled={salvando}>Annulla</Button>
            <Button type="submit" disabled={!valori.esito || salvando}>{salvando ? "Salvataggio..." : "Registra"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Ci penso dopo": i segnali spariscono da Oggi fino al giorno scelto. */
function DialogoRimanda({ persona, aperto, onChiudi, onFatto }) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const rimanda = async (giorni) => {
    setSalvando(true);
    try {
      await api.persone.rimanda(persona.persona_id, giorni);
      onFatto();
      onChiudi();
    } catch (err) {
      toast({ title: "Non rimandato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };
  return (
    <Dialog open={aperto} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rimanda</DialogTitle>
          <DialogDescription>{persona.nome} torna in Oggi…</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {RIMANDI.map((r) => (
            <Button key={r.giorni} variant="outline" disabled={salvando} onClick={() => rimanda(r.giorni)}>{r.etichetta}</Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Le azioni su una persona da seguire: chiamarla, scriverle su WhatsApp (un link: nessuna
 * integrazione), mandarle un'email, registrare com'è andata, rimandare. Le stesse in Oggi e
 * nella scheda.
 *
 * Il contatto con un lead passa dalle azioni del lead (ne cambia lo stato); con un socio finisce
 * nel diario e ne nasconde i segnali per qualche giorno.
 *
 * @param persona una riga di GET /api/segnali
 */
export default function AzioniPersona({ persona, puoModificare, onFatto, className = "" }) {
  const [aperta, setAperta] = useState(null);
  const nome = String(persona.nome ?? "").split(" ")[0];
  const whatsapp = linkWhatsApp(persona.telefono, testoMessaggio(nome, persona.da_fare?.[0]));
  const lead = !persona.socio_id && persona.trattativa_id;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {persona.telefono && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={`tel:${persona.telefono}`}><Phone className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Chiama</span></a></Button>
      )}
      {whatsapp && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">WhatsApp</span></a></Button>
      )}
      {persona.email && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={`mailto:${persona.email}`}><Mail className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Email</span></a></Button>
      )}
      {puoModificare && (
        <>
          <Button size="sm" className="h-9" onClick={() => setAperta("contatto")}><Check className="w-4 h-4 mr-1" /> Fatto</Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setAperta("rimanda")}><Clock className="w-4 h-4 mr-1" /> Rimanda</Button>
          {/* Uno scaduto che non torna si chiude con il suo motivo: archiviato, esce da Oggi. */}
          {persona.socio_id && !persona.archiviato_il && persona.da_fare?.includes("scaduto_recuperabile") && (
            <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => setAperta("abbandono")}><UserX className="w-4 h-4 mr-1" /> Non torna</Button>
          )}
        </>
      )}
      {persona.socio_id && (
        <DialogoAbbandono socio={{ id: persona.socio_id, nome: persona.nome }} aperto={aperta === "abbandono"} onChiudi={() => setAperta(null)} onFatto={onFatto} />
      )}
      {lead ? (
        <AzioneLead
          richiesta={aperta === "contatto" ? { tipo: "contatto", lead: { id: persona.trattativa_id, nome: persona.nome, cognome: "", telefono: persona.telefono } } : null}
          onChiudi={() => setAperta(null)} onFatto={onFatto}
        />
      ) : (
        <DialogoContatto persona={persona} aperto={aperta === "contatto"} onChiudi={() => setAperta(null)} onFatto={onFatto} />
      )}
      <DialogoRimanda persona={persona} aperto={aperta === "rimanda"} onChiudi={() => setAperta(null)} onFatto={onFatto} />
    </div>
  );
}
