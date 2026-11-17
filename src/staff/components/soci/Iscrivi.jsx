import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import CampiAnagrafica, { ANAGRAFICA_VUOTA, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import { SceltaFoto } from "@/staff/components/soci/FotoSocio";
import { caricaFile } from "@/staff/lib/uploads";
import { generaPasswordTemporanea } from "@/staff/lib/passwordTemporanea";
import { dataFineAbbonamento, descriviDurata, motivoNonVendibile, oggiIso } from "@/core/domain/abbonamenti";
import { formatData, formatEuro } from "@/core/domain/format";

const PASSI = [
  { valore: "anagrafica", etichetta: "Anagrafica" },
  { valore: "abbonamento", etichetta: "Abbonamento", facoltativo: true },
  { valore: "privacy", etichetta: "Privacy" },
  { valore: "accesso", etichetta: "Portale", facoltativo: true },
];
const INIZIO = { plan_id: "", start_date: oggiIso() };

/**
 * Iscrivi: la finestra con cui si diventa soci, in un passo solo per la reception.
 *
 * Quattro passi — anagrafica, abbonamento, privacy, credenziali del portale — e un salvataggio
 * alla fine, in una transazione sul server (POST /api/iscrivi): o nasce tutto, o niente.
 * Abbonamento e portale si possono saltare; l'informativa privacy firmata no. (Il certificato e i
 * consensi promozionali con il modulo firmato sono usciti a novembre 2026: docs/piani/portale.md.)
 *
 * Un ex socio con lo stesso codice fiscale ritrova la sua scheda.
 */
export default function Iscrivi({ aperto, onChiudi }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [passo, setPasso] = useState(0);
  const [anagrafica, setAnagrafica] = useState(ANAGRAFICA_VUOTA);
  const [foto, setFoto] = useState({ file: null, rimossa: false });
  const [tipi, setTipi] = useState([]);
  const [abbonamento, setAbbonamento] = useState(INIZIO);
  const [privacy, setPrivacy] = useState(false);
  const [password, setPassword] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Ogni apertura riparte da capo.
  useEffect(() => {
    if (!aperto) return;
    setPasso(0);
    setFoto({ file: null, rimossa: false });
    setAbbonamento(INIZIO);
    setPrivacy(false);
    setPassword(generaPasswordTemporanea());
    setAnagrafica(ANAGRAFICA_VUOTA);
    api.entities.Plan.list().then((elenco) => setTipi(elenco.filter((p) => !motivoNonVendibile(p)))).catch(() => setTipi([]));
  }, [aperto]);

  const tipo = tipi.find((p) => p.id === abbonamento.plan_id);
  const scadenza = tipo ? dataFineAbbonamento(abbonamento.start_date, tipo.durata_valore, tipo.durata_unita) : null;
  const conEmail = Boolean(anagrafica.email.trim());
  const incompleto = motivoAnagraficaIncompleta(anagrafica);
  const corrente = PASSI[passo];
  const ultimo = passo === PASSI.length - 1;
  // Si va avanti solo con il passo completo; i facoltativi si saltano.
  // Perché "Avanti" è spento, in parole, per lo screen reader: spento e basta non diceva niente.
  const bloccato = (corrente.valore === "anagrafica" && incompleto)
    || (corrente.valore === "privacy" && !privacy && "Serve l'informativa privacy firmata.")
    || null;

  const salta = () => {
    if (corrente.valore === "abbonamento") setAbbonamento(INIZIO);
    // L'ultimo passo saltato è "iscrivi senza accesso": si conferma subito, senza aspettare lo stato.
    if (ultimo) conferma({ senzaAccesso: true }); else setPasso((p) => p + 1);
  };

  async function conferma({ senzaAccesso = false } = {}) {
    setSalvando(true);
    try {
      // La foto si carica prima: il server riceve solo il suo indirizzo.
      // ponytail: se poi l'iscrizione fallisce il file resta orfano; lo toglie `npm run manutenzione:file-orfani`.
      const foto_url = foto.file ? (await caricaFile({ file: foto.file })).file_url : undefined;
      const accesso = password && conEmail && !senzaAccesso ? { password } : undefined;
      const { member, riattivato, accesso_portale: portale } = await api.iscrivi({
        anagrafica: { ...anagrafica, ...(foto_url ? { foto_url } : {}) },
        abbonamento: tipo ? { plan_id: tipo.id, start_date: abbonamento.start_date } : undefined,
        informativa_privacy: privacy,
        portale: accesso,
      });
      toast({
        title: riattivato ? "Socio riattivato" : "Socio iscritto",
        description: `${member.full_name}${riattivato ? " è tornato socio, con il suo codice." : ` è socio, codice ${member.codice_socio}.`}${portale ? ` Password del portale: ${accesso.password}` : ""}`,
      });
      onChiudi(true);
      navigate(`/crm/soci/${member.id}`);
    } catch (err) {
      toast({ title: "Iscrizione non riuscita", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  }

  return (
    <Dialog open={aperto} onOpenChange={(v) => { if (!v && !salvando) onChiudi(false); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Iscrivi</DialogTitle>
          <DialogDescription>
            Si salva tutto insieme alla fine: nessun socio resta a metà.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex gap-1 text-xs" aria-label="Passi">
          {PASSI.map((p, i) => (
            <li key={p.valore} aria-current={i === passo ? "step" : undefined}
              className={`flex-1 border-t-2 pt-1 ${i < passo ? "border-primary text-foreground" : i === passo ? "border-primary font-medium text-foreground" : "border-muted text-muted-foreground"}`}>
              {p.etichetta}
            </li>
          ))}
        </ol>

        <form onSubmit={(e) => { e.preventDefault(); if (ultimo) conferma(); else setPasso((p) => p + 1); }} className="space-y-4">
          {corrente.valore === "anagrafica" && (
            <>
              <CampiAnagrafica valori={anagrafica} onChange={setAnagrafica} />
              <SceltaFoto socio={anagrafica} file={foto.file} onChange={setFoto} />
            </>
          )}

          {corrente.valore === "abbonamento" && (
            <div className="space-y-3">
              <div>
                <Label>Tipo di abbonamento</Label>
                <Select value={abbonamento.plan_id || undefined} onValueChange={(plan_id) => setAbbonamento((a) => ({ ...a, plan_id }))}>
                  <SelectTrigger aria-label="Tipo di abbonamento"><SelectValue placeholder="Scegli" /></SelectTrigger>
                  <SelectContent>
                    {tipi.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {descriviDurata(p.durata_valore, p.durata_unita)} · {formatEuro(p.price)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="iscrivi-inizio">Dal</Label>
                <Input id="iscrivi-inizio" type="date" value={abbonamento.start_date} onChange={(e) => setAbbonamento((a) => ({ ...a, start_date: e.target.value }))} />
              </div>
              {scadenza && <p className="text-sm text-muted-foreground">Scade il {formatData(scadenza, "lungo")}.</p>}
            </div>
          )}

          {corrente.valore === "privacy" && (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={privacy} onCheckedChange={(v) => setPrivacy(v === true)} className="mt-0.5" aria-label="Informativa privacy firmata" />
              <span><span className="font-medium">Ha ricevuto e firmato l'informativa privacy.</span> Serve per iscriversi.</span>
            </label>
          )}

          {corrente.valore === "accesso" && (
            conEmail ? (
              <div className="space-y-2 text-sm">
                <p>Accesso al portale con <span className="font-medium">{anagrafica.email}</span> e questa password, da cambiare al primo accesso:</p>
                <p className="font-mono text-lg tracking-wider bg-muted rounded px-3 py-2 select-all">{password || "—"}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPassword(generaPasswordTemporanea())}>Generane un'altra</Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Senza email non si crea l'accesso al portale: aggiungila all'anagrafica, o salta e crealo dopo dalla scheda.</p>
            )
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <Button type="button" variant="outline" onClick={() => (passo ? setPasso((p) => p - 1) : onChiudi(false))} disabled={salvando}>
              {passo ? "Indietro" : "Annulla"}
            </Button>
            {/* Il perché lo legge lo screen reader; a vista basta il passo incompleto. */}
            <p role="status" aria-live="polite" className="sr-only">{bloccato}</p>
            {/* `sm:ml-auto`: senza il paragrafo che allargava la riga, "Avanti" resta a destra. */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:ml-auto">
              {corrente.facoltativo && <Button type="button" variant="ghost" onClick={salta} disabled={salvando}>Salta</Button>}
              <Button type="submit" disabled={Boolean(bloccato) || salvando}>
                {salvando ? "Iscrizione..." : ultimo ? "Iscrivi" : "Avanti"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
