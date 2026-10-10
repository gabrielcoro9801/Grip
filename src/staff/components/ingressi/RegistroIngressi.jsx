import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/ui/primitivi/dialog";
import { AvatarSocio } from "@/staff/components/soci/FotoSocio";
import SegnaliBancone from "@/staff/components/ingressi/SegnaliBancone";
import { useToast } from "@/ui/primitivi/use-toast";
import { useConfirm } from "@/ui/ConfirmDialog";
import { oggiIso, oraIso } from "@/core/domain/giorni";
import { CheckCircle2, AlertTriangle, XCircle, Search, Plus, Trash2 } from "lucide-react";

// Il semaforo: colore di stato, icona ed etichetta insieme, mai il colore da solo.
const SEMAFORO = {
  verde: { etichetta: "In regola", icona: CheckCircle2, classi: "border-success/40 bg-success/10", testo: "text-success" },
  giallo: { etichetta: "In regola, ma c'è da sistemare", icona: AlertTriangle, classi: "border-warning/40 bg-warning/10", testo: "text-warning" },
  rosso: { etichetta: "Non in regola", icona: XCircle, classi: "border-destructive/40 bg-destructive/10", testo: "text-destructive" },
};
const ESITI = { ammesso: "In regola", ammesso_con_avvisi: "Con avvisi", ammesso_in_deroga: "In deroga" };
const TONO_ESITO = { ammesso: "text-success", ammesso_con_avvisi: "text-warning", ammesso_in_deroga: "text-destructive" };
// Un ingresso di pochi minuti fa: probabilmente è lo stesso, lo si dice ma non si blocca.
const MINUTI_DOPPIO = 15;

/** "AAAA-MM-GG" e "HH:MM" letti come ora di Roma → l'istante, qualunque sia il fuso del browser. */
function istanteRoma(giorno, ora) {
  const comeUtc = new Date(`${giorno}T${ora}:00Z`);
  const scartoRoma = new Date(`${oggiIso(comeUtc)}T${oraIso(comeUtc)}:00Z`) - comeUtc;
  return new Date(comeUtc.getTime() - scartoRoma);
}

/**
 * Il registro degli ingressi di un giorno. Lo staff aggiunge a mano le eccezioni — telefono
 * dimenticato, abbonamento appena scaduto — anche con un orario passato, e annulla quelli
 * registrati per errore.
 */
export default function RegistroIngressi({ puoRegistrare }) {
  const { toast } = useToast();
  const [conferma, dialogoConferma] = useConfirm();
  const [giorno, setGiorno] = useState(oggiIso());
  const [righe, setRighe] = useState(null);
  const [aperta, setAperta] = useState(false);

  const carica = useCallback(() => {
    api.ingressi.elenco({ dal: giorno, al: giorno }).then((r) => setRighe(r.ingressi)).catch(() => setRighe([]));
  }, [giorno]);
  useEffect(() => { setRighe(null); carica(); }, [carica]);

  const annulla = async (riga) => {
    const ok = await conferma({
      title: `Annullare l'ingresso di ${riga.nome}?`,
      description: `Quello delle ${oraIso(new Date(riga.entrato_alle))}. Sparisce dal registro e dalle statistiche.`,
      confirmLabel: "Annulla l'ingresso",
      cancelLabel: "Lascialo",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.ingressi.annulla(riga.id);
      carica();
    } catch (err) {
      toast({ title: "Ingresso non annullato", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="giorno-ingressi">Giorno</Label>
            <Input
              id="giorno-ingressi" type="date" value={giorno} max={oggiIso()} className="w-auto"
              onChange={(e) => e.target.value && setGiorno(e.target.value)}
            />
          </div>
          {puoRegistrare && (
            <Button onClick={() => setAperta(true)}><Plus className="w-4 h-4 mr-1" /> Registra ingresso</Button>
          )}
        </div>

        <h2 className="text-sm font-semibold">
          Ingressi {giorno === oggiIso() ? "di oggi" : "del giorno"}{" "}
          {righe && <span className="text-muted-foreground font-normal">({righe.length})</span>}
        </h2>
        {righe === null ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : righe.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun ingresso registrato in questo giorno.</p>
        ) : (
          <ul className="divide-y divide-border">
            {righe.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular-nums text-muted-foreground w-12">{oraIso(new Date(r.entrato_alle))}</span>
                <Link to={`/crm/soci/${r.member_id}`} className="font-medium hover:underline min-w-0 truncate">{r.nome}</Link>
                <span className={`text-xs ${TONO_ESITO[r.esito]}`}>{ESITI[r.esito]}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {r.metodo === "manuale" ? "A mano" : "QR"}{r.registrato_da ? ` · ${r.registrato_da}` : ""}
                </span>
                {puoRegistrare && (
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => annulla(r)} aria-label={`Annulla l'ingresso di ${r.nome}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {aperta && <RegistraIngresso giorno={giorno} onChiudi={() => setAperta(false)} onRegistrato={carica} />}
      {dialogoConferma}
    </Card>
  );
}

/** La finestra per registrare a mano: chi, a che ora, e se è in regola in quel giorno. */
function RegistraIngresso({ giorno, onChiudi, onRegistrato }) {
  const { toast } = useToast();
  const [ora, setOra] = useState(giorno === oggiIso() ? oraIso() : "");
  const [soci, setSoci] = useState(null);
  const [cerca, setCerca] = useState("");
  const [scelto, setScelto] = useState(null); // il socio scelto: { id, full_name }
  const [scheda, setScheda] = useState(null); // la risposta di verifica
  const [lavoro, setLavoro] = useState(false);

  useEffect(() => {
    api.entities.Member.list().then((m) => setSoci(m.filter((s) => !s.archiviato_il))).catch(() => setSoci([]));
  }, []);
  const trovati = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    if (t.length < 2 || !soci) return [];
    return soci.filter((s) => `${s.full_name} ${s.codice_socio}`.toLowerCase().includes(t)).slice(0, 6);
  }, [cerca, soci]);

  const alle = ora ? istanteRoma(giorno, ora) : null;
  const nelFuturo = alle && alle.getTime() > Date.now() + 60_000;

  // Il semaforo dipende dal giorno: si richiede quando cambia il socio o l'orario.
  useEffect(() => {
    if (!scelto || !alle || nelFuturo) { setScheda(null); return; }
    let attuale = true;
    api.ingressi.verifica({ member_id: scelto.id, alle: alle.toISOString() })
      .then((r) => attuale && setScheda(r.valido ? r : null))
      .catch(() => attuale && setScheda(null));
    return () => { attuale = false; };
  }, [scelto?.id, giorno, ora]);

  const stato = scheda ? SEMAFORO[scheda.semaforo] : null;
  const rosso = scheda?.semaforo === "rosso";
  const recente = scheda?.ultimo_ingresso && alle && Math.abs(alle - new Date(scheda.ultimo_ingresso)) < MINUTI_DOPPIO * 60_000;

  const registra = async () => {
    setLavoro(true);
    try {
      await api.ingressi.registra({ member_id: scelto.id, metodo: "manuale", deroga: rosso, entrato_alle: alle.toISOString() });
      toast({ title: "Ingresso registrato", description: `${scelto.full_name} alle ${ora}.` });
      onRegistrato();
      onChiudi();
    } catch (err) {
      toast({ title: "Ingresso non registrato", description: err.message, variant: "destructive" });
    }
    setLavoro(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onChiudi()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registra ingresso</DialogTitle>
          <DialogDescription>
            Per chi non può usare il QR, o entra lo stesso. {giorno === oggiIso() ? "Oggi" : `Il ${giorno.split("-").reverse().join("/")}`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {scelto ? (
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium truncate">{scelto.full_name}</p>
              <Button variant="outline" size="sm" onClick={() => { setScelto(null); setScheda(null); }}>Cambia</Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input autoFocus value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca il socio per nome o codice" className="pl-9" aria-label="Cerca socio" />
              {trovati.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
                  {trovati.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50" onClick={() => { setCerca(""); setScelto(s); }}>
                        {s.full_name} <span className="text-xs text-muted-foreground font-mono">{s.codice_socio}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="ora-ingresso">Ora di ingresso</Label>
            <Input id="ora-ingresso" type="time" value={ora} onChange={(e) => setOra(e.target.value)} className="w-auto" />
            {nelFuturo && <p className="text-xs text-destructive">L'orario è nel futuro.</p>}
          </div>

          {stato && (
            <div className={`rounded-xl border-2 p-4 space-y-3 ${stato.classi}`} role="status" aria-live="polite">
              <div className="flex items-center gap-3">
                <AvatarSocio socio={{ full_name: scheda.socio.nome, foto_url: scheda.socio.foto_url }} />
                <p className={`text-sm font-semibold flex items-center gap-1.5 ${stato.testo}`}><stato.icona className="w-4 h-4" aria-hidden="true" /> {stato.etichetta}</p>
              </div>
              {scheda.avvisi.length > 0 && (
                <ul className="space-y-1.5">
                  {scheda.avvisi.map((a) => (
                    <li key={a.codice} className="text-sm flex items-start gap-2">
                      {a.gravita === "rosso"
                        ? <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
                        : <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" aria-hidden="true" />}
                      <span><span className="font-medium">{a.titolo}.</span> {a.testo}</span>
                    </li>
                  ))}
                </ul>
              )}
              {scheda.lezioni_oggi.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Lezioni: {scheda.lezioni_oggi.map((l) => `${l.corso} alle ${l.inizio}${l.stato === "waitlisted" ? " (in lista d'attesa)" : ""}`).join(", ")}
                </p>
              )}
              {/* Chi entra adesso: "scade tra 3 giorni: proponi il rinnovo", "bentornato", gli auguri. */}
              <SegnaliBancone key={scheda.socio.id} personaId={scheda.socio.persona_id} segnali={scheda.segnali} puoRegistrare />
              {recente && <p className="text-sm">Ha già un ingresso alle {oraIso(new Date(scheda.ultimo_ingresso))}: controlla che non sia lo stesso.</p>}
              {rosso && <p className="text-sm font-medium">Verrà segnato come ingresso in deroga.</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onChiudi}>Chiudi</Button>
          <Button variant={rosso ? "destructive" : "default"} disabled={!scheda || lavoro || nelFuturo} onClick={registra}>
            {rosso ? "Registra comunque" : "Registra ingresso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
