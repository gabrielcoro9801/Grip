import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { useToast } from "@/ui/primitivi/use-toast";
import AzioneLead from "@/staff/components/lead/AzioneLead";
import { linkWhatsApp } from "@/core/domain/anagrafica";
import { testoMessaggio } from "@/core/domain/segnali";
import DialogoAbbandono from "@/staff/components/soci/DialogoAbbandono";
import { Phone, MessageCircle, Mail, Check, UserX, CreditCard, FileUp, UserRound } from "lucide-react";

/** I quattro modi di dire "fatto": il mezzo finisce nel diario ("Fatto: chiamato"). */
const MODI_FATTO = [
  { canale: "di_persona", etichetta: "Di persona", icona: UserRound },
  { canale: "telefono", etichetta: "Chiamato", icona: Phone },
  { canale: "whatsapp", etichetta: "Messaggio", icona: MessageCircle },
  { canale: "email", etichetta: "Email", icona: Mail },
];

/**
 * Il box "Fatto": un tocco, e quei segnali spariscono da Da fare per qualche giorno (le soglie,
 * `contattoNascondeGiorni`). Niente finestre né esiti da compilare: chi lavora la lista non lo
 * farebbe, e il diario dice già chi, come e quando.
 */
function BoxFatto({ persona, segnali, onFatto }) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const segna = async (canale) => {
    setSalvando(true);
    try {
      await api.persone.fatto(persona.persona_id, { canale, segnali });
      toast({ title: `${persona.nome}: fatto`, description: "Segnato nel diario." });
      onFatto?.();
    } catch (err) {
      toast({ title: "Non segnato", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2 py-1.5" role="group" aria-label={`Fatto: ${persona.nome}`}>
      <span className="flex items-center gap-1 text-xs font-medium text-success pr-1"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Fatto</span>
      {MODI_FATTO.map((m) => (
        <Button key={m.canale} size="sm" variant="ghost" className="h-8 px-2 hover:bg-success/15" disabled={salvando} onClick={() => segna(m.canale)}>
          <m.icona className="w-3.5 h-3.5 mr-1" aria-hidden="true" />{m.etichetta}
        </Button>
      ))}
    </div>
  );
}

/**
 * Le azioni su una riga di Da fare. Ogni linea si risolve con la sua azione: un rinnovo con
 * l'abbonamento (Rinnova, o Non torna per uno scaduto), un documento caricandolo — tutti e due
 * spariscono da soli — e il resto con il box "Fatto". Chiamare, scrivere su WhatsApp (un link:
 * nessuna integrazione) e mandare un'email aprono le app del telefono o del computer.
 *
 * Un contatto (lead) si lavora con le sue azioni, che ne cambiano lo stato (AzioneLead).
 *
 * @param persona una riga di GET /api/segnali
 * @param linea   la linea della riga (shared/segnali.js, LINEE)
 * @param segnali i codici della riga, quelli di questa linea
 */
export default function AzioniPersona({ persona, linea, segnali = [], puoModificare, onFatto, className = "" }) {
  const [aperta, setAperta] = useState(null);
  const nome = String(persona.nome ?? "").split(" ")[0];
  const whatsapp = linkWhatsApp(persona.telefono, testoMessaggio(nome, segnali[0]));
  const lead = !persona.socio_id && persona.trattativa_id;
  const scheda = persona.socio_id ? `/crm/soci/${persona.socio_id}` : null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {persona.telefono && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={`tel:${persona.telefono}`}><Phone className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Chiama</span></a></Button>
      )}
      {whatsapp && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">WhatsApp</span></a></Button>
      )}
      {persona.email && (
        <Button asChild size="sm" variant="outline" className="h-9"><a href={`mailto:${persona.email}`}><Mail className="w-4 h-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Email</span></a></Button>
      )}

      {puoModificare && scheda && linea === "rinnovi" && (
        <Button asChild size="sm" className="h-9"><Link to={`${scheda}?azione=rinnova`}><CreditCard className="w-4 h-4 mr-1" /> Rinnova</Link></Button>
      )}
      {puoModificare && scheda && linea === "documenti" && (
        <Button asChild size="sm" className="h-9"><Link to={`${scheda}?azione=documenti`}><FileUp className="w-4 h-4 mr-1" /> Carica</Link></Button>
      )}
      {/* Uno scaduto che non torna si chiude con il suo motivo: archiviato, esce da Da fare. */}
      {puoModificare && persona.socio_id && !persona.archiviato_il && segnali.includes("scaduto_recuperabile") && (
        <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => setAperta("abbandono")}><UserX className="w-4 h-4 mr-1" /> Non torna</Button>
      )}

      {puoModificare && (lead ? (
        <Button size="sm" className="h-9" onClick={() => setAperta("contatto")}><Phone className="w-4 h-4 mr-1" /> Contattato</Button>
      ) : persona.socio_id && segnali.length > 0 && (
        <BoxFatto persona={persona} segnali={segnali} onFatto={onFatto} />
      ))}

      {persona.socio_id && (
        <DialogoAbbandono socio={{ id: persona.socio_id, nome: persona.nome }} aperto={aperta === "abbandono"} onChiudi={() => setAperta(null)} onFatto={onFatto} />
      )}
      {lead && (
        <AzioneLead
          richiesta={aperta === "contatto" ? { tipo: "contatto", lead: { id: persona.trattativa_id, nome: persona.nome, cognome: "", telefono: persona.telefono } } : null}
          onChiudi={() => setAperta(null)} onFatto={onFatto}
        />
      )}
    </div>
  );
}
