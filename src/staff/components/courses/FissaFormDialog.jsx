import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { useToast } from "@/ui/primitivi/use-toast";
import SceltaSocio from "@/staff/components/courses/SceltaSocio";
import { oggiIso } from "@/core/domain/giorni";
import { formatData } from "@/core/domain/format";
import { conSospensioni, fineCopertura } from "@/core/domain/abbonamenti";
import { nomeGiorno, hhmm } from "@/staff/lib/modificaEvento";
import {
  MASSIMO_LEZIONI_FISSA, lezioniDaTenere, limiteFissa, descriviLimite, controllaPeriodo,
} from "@/staff/lib/fisse";

const piuTardi = (a, b) => (a > b ? a : b);
const sessioneInBreve = (s) => `${s.corso} · ${s.giorno ? `ogni ${nomeGiorno(s.giorno)}` : "date scelte"} ${hhmm(s.start_time ?? s.inizio)}–${hhmm(s.end_time ?? s.fine)}`;

/**
 * Creare o cambiare una prenotazione fissa: un socio a una sessione, da una data a un'altra. La
 * usano Sessioni (la sessione è quella della riga, il socio si sceglie) e la scheda del socio (il
 * socio è lui, la sessione si sceglie).
 *
 * La fine si scrive come data o come numero di lezioni, che diventa subito una data: quella
 * dell'N-esima lezione. Non va oltre l'ultima lezione della sessione né oltre la fine
 * dell'abbonamento del socio (dopo le sospensioni): la finestra dice il limite prima, il server
 * lo controlla comunque.
 *
 * In modifica il server lavora sulla differenza: prenota i giorni aggiunti, disdice quelli tolti,
 * non tocca quelli in mezzo.
 *
 * @param sessione   la sessione ({ id, corso, giorno, start_time, end_time }), o null per sceglierla fra `sessioni`
 * @param sessioni   le sessioni fra cui scegliere (GET /api/calendario/sessioni)
 * @param socio      il socio ({ id, nome, cognome } o { id, full_name }), o null per sceglierlo
 * @param fissa      in modifica, la fissa (GET /api/prenotazioni-fisse)
 * @param giaConFissa Set di chi ha già una fissa: i soci di questa sessione, o (dalla scheda del
 *   socio) le sessioni in cui lui ce l'ha già
 * @param onSalvata  () => void
 */
export default function FissaFormDialog({
  open, onClose, sessione = null, sessioni = [], socio = null, fissa = null, giaConFissa = new Set(), onSalvata,
}) {
  const { toast } = useToast();
  const oggi = oggiIso();
  const inModifica = !!fissa;
  const [scelto, setScelto] = useState(null);
  const [idSessione, setIdSessione] = useState("");
  const [modulo, setModulo] = useState({ dal: oggi, fine: "data", al: "", numero: "" });
  const [lezioni, setLezioni] = useState(null); // le lezioni della sessione da oggi, o { errore }
  const [iscrizioni, setIscrizioni] = useState(undefined); // undefined = non lette (o non leggibili)
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    if (!open) return;
    setScelto(null);
    setIdSessione(sessione?.id ?? fissa?.event_id ?? "");
    setModulo(fissa
      ? { dal: fissa.dal, fine: "data", al: fissa.al ?? "", numero: "" }
      : { dal: oggi, fine: "data", al: "", numero: "" });
    setErrore("");
  }, [open, sessione, fissa, oggi]);

  const laSessione = sessione ?? sessioni.find((s) => s.id === idSessione) ?? null;
  const idSocio = socio?.id ?? fissa?.member_id ?? scelto?.id ?? null;
  const nomeSocio = socio ? (socio.full_name ?? `${socio.nome} ${socio.cognome}`) : fissa ? fissa.socio : scelto ? `${scelto.nome} ${scelto.cognome}` : "";

  // Le lezioni della sessione da oggi: per «per N lezioni», per l'ultima lezione, per dire quante.
  useEffect(() => {
    if (!open || !idSessione) { setLezioni(null); return undefined; }
    let vivo = true;
    setLezioni(null);
    api.calendario.lezioni({ evento_id: idSessione, dal: oggi })
      .then((r) => { if (vivo) setLezioni(r.lezioni); })
      .catch((err) => { if (vivo) setLezioni({ errore: err.message }); });
    return () => { vivo = false; };
  }, [open, idSessione, oggi]);

  // Gli abbonamenti del socio, con le date dopo le sospensioni: per il limite. Se non si possono
  // leggere, il limite è solo la sessione e l'abbonamento lo controlla il server.
  useEffect(() => {
    if (!open || !idSocio) { setIscrizioni(undefined); return undefined; }
    let vivo = true;
    setIscrizioni(undefined);
    Promise.all([api.entities.Subscription.filter({ member_id: idSocio }), api.soci.sospensioni(idSocio)])
      .then(([abbonamenti, { sospensioni }]) => { if (vivo) setIscrizioni(conSospensioni(abbonamenti, sospensioni)); })
      .catch(() => { if (vivo) setIscrizioni(undefined); });
    return () => { vivo = false; };
  }, [open, idSocio]);

  const pronte = Array.isArray(lezioni);
  const daTenere = useMemo(() => (pronte ? lezioniDaTenere(lezioni, piuTardi(modulo.dal || oggi, oggi)) : []), [pronte, lezioni, modulo.dal, oggi]);
  const ultimaLezione = pronte ? lezioni.filter((l) => l.status === "active").map((l) => l.date).sort().pop() ?? null : null;
  const fineAbbonamento = iscrizioni === undefined ? undefined : fineCopertura(iscrizioni, piuTardi(modulo.dal || oggi, oggi));
  const limite = limiteFissa({ ultimaLezione, fineAbbonamento });
  const esito = pronte && idSocio ? controllaPeriodo(modulo, daTenere, limite, inModifica && modulo.dal === fissa.dal ? modulo.dal : oggi) : null;

  const salva = async () => {
    setInCorso(true);
    setErrore("");
    const periodo = { dal: modulo.dal, ...(modulo.fine === "numero" ? { numero: Number(modulo.numero) } : { al: modulo.al }) };
    try {
      const r = inModifica
        ? await api.prenotazioniFisse.modifica(fissa.id, periodo)
        : await api.prenotazioniFisse.crea({ member_id: idSocio, event_id: idSessione, ...periodo });
      const parti = [`${r.prenotate} prenotate`];
      if (r.in_attesa) parti.push(`${r.in_attesa} in lista d'attesa`);
      if (r.senza_abbonamento) parti.push(`${r.senza_abbonamento} senza abbonamento`);
      if (r.disdette) parti.push(`${r.disdette} disdette`);
      toast({ title: inModifica ? "Prenotazione fissa cambiata" : "Prenotazione fissa creata", description: `${nomeSocio}: ${parti.join(", ")}.` });
      onClose();
      onSalvata?.();
    } catch (err) {
      setErrore(err.message);
    }
    setInCorso(false);
  };

  const scriviModulo = (campo) => (e) => setModulo({ ...modulo, [campo]: e.target.value });
  // In modifica una fissa già cominciata tiene il suo inizio: le lezioni passate sono andate.
  const dalBloccato = inModifica && fissa.dal < oggi;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !inCorso) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{inModifica ? "Modifica prenotazione fissa" : "Nuova prenotazione fissa"}</DialogTitle>
          <DialogDescription>
            {[nomeSocio, laSessione && sessioneInBreve(laSessione)].filter(Boolean).join(" · ") || "Un socio a una sessione, da una data a un'altra."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!sessione && !inModifica && (
            <div>
              <Label>Sessione *</Label>
              <Select value={idSessione || undefined} onValueChange={setIdSessione}>
                <SelectTrigger aria-label="Sessione"><SelectValue placeholder="Scegli la sessione" /></SelectTrigger>
                <SelectContent>
                  {sessioni.map((s) => <SelectItem key={s.id} value={s.id} disabled={giaConFissa.has(s.id)}>{sessioneInBreve(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              {sessioni.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nessuna sessione in corso.</p>}
            </div>
          )}

          {!socio && !inModifica && (
            <div>
              <Label className="mb-2 block">Socio *</Label>
              <SceltaSocio scelto={scelto} onScegli={setScelto} giaPrenotati={giaConFissa} etichettaGiaScelti="Ha già la fissa in questa sessione" />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fissa-dal">Dal *</Label>
              <Input id="fissa-dal" type="date" required min={dalBloccato ? undefined : oggi} disabled={dalBloccato} value={modulo.dal} onChange={scriviModulo("dal")} />
            </div>
            <div>
              <Label>Fine *</Label>
              <Select value={modulo.fine} onValueChange={(v) => setModulo({ ...modulo, fine: v })}>
                <SelectTrigger aria-label="Fine della fissa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data">Fino a una data</SelectItem>
                  <SelectItem value="numero">Per N lezioni</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {modulo.fine === "data" ? (
            <div>
              <Label htmlFor="fissa-al">Al *</Label>
              <Input
                id="fissa-al" type="date" required min={modulo.dal || oggi} max={limite.al || undefined}
                value={modulo.al} onChange={scriviModulo("al")}
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="fissa-numero">Numero di lezioni *</Label>
              <Input id="fissa-numero" type="number" min="1" max={MASSIMO_LEZIONI_FISSA} required value={modulo.numero} onChange={scriviModulo("numero")} />
            </div>
          )}
          <p className="text-xs text-muted-foreground -mt-2">
            {!idSessione ? "" : lezioni?.errore ? `Lezioni non lette: ${lezioni.errore}` : !pronte ? "Lettura delle lezioni…" : descriviLimite(limite)}
          </p>

          {esito && (modulo.fine === "data" ? modulo.al : modulo.numero) && (
            esito.errore ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{esito.errore}</span>
              </div>
            ) : (
              <p className="p-3 rounded-lg text-sm bg-info/10 border border-info/30 text-info">
                {esito.lezioni === 1 ? "1 lezione" : `${esito.lezioni} lezioni`}, fino al {formatData(esito.al, "breve")}.
                {" "}Se una è al completo il socio va in lista d'attesa.
              </p>
            )
          )}
          {errore && <p role="alert" className="text-sm text-destructive">{errore}</p>}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={inCorso}>Annulla</Button>
            <Button onClick={salva} disabled={inCorso || !idSocio || !idSessione || !esito || !!esito.errore}>
              {inCorso ? "Salvataggio…" : inModifica ? "Salva" : "Crea la fissa"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
