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
import CampiAnagrafica, { ANAGRAFICA_VUOTA, anagraficaDi, motivoAnagraficaIncompleta } from "@/staff/components/soci/CampiAnagrafica";
import { SceltaFoto } from "@/staff/components/soci/FotoSocio";
import { caricaFile } from "@/staff/lib/uploads";
import { generaPasswordTemporanea } from "@/staff/lib/qrUtils";
import { dataFineAbbonamento, descriviDurata, motivoNonVendibile, oggiIso } from "@/core/domain/abbonamenti";
import { TIPI_CONSENSO } from "@/core/domain/consensi";
import { formatData, formatEuro } from "@/core/domain/format";
import { spostaGiorni } from "@/core/domain/giorni";

const PASSI = [
  { valore: "anagrafica", etichetta: "Anagrafica" },
  { valore: "abbonamento", etichetta: "Abbonamento", facoltativo: true },
  { valore: "certificato", etichetta: "Certificato", facoltativo: true },
  { valore: "privacy", etichetta: "Privacy" },
  { valore: "accesso", etichetta: "Portale", facoltativo: true },
];
const INIZIO = { plan_id: "", start_date: oggiIso() };

/**
 * Iscrivi: la finestra con cui si diventa soci, in un passo solo per la reception.
 *
 * Cinque passi — anagrafica, abbonamento, certificato, privacy, credenziali del portale — e un
 * salvataggio alla fine, in una transazione sul server (POST /api/iscrivi): o nasce tutto, o
 * niente. Abbonamento, certificato e portale si possono saltare; l'informativa privacy firmata no.
 *
 * Da un contatto (`lead`) parte da quello che si sa già — nome e recapiti, o tutta la vecchia
 * scheda di un ex socio — e la storia resta nel diario della persona. Senza contatto è chi entra
 * direttamente: un ex socio con lo stesso codice fiscale ritrova la sua scheda.
 */
export default function Iscrivi({ aperto, lead = null, onChiudi }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [passo, setPasso] = useState(0);
  const [anagrafica, setAnagrafica] = useState(ANAGRAFICA_VUOTA);
  const [foto, setFoto] = useState({ file: null, rimossa: false });
  const [tipi, setTipi] = useState([]);
  const [abbonamento, setAbbonamento] = useState(INIZIO);
  const [certificato, setCertificato] = useState({ file: null, expiry_date: spostaGiorni(oggiIso(), 365) });
  const [privacy, setPrivacy] = useState(false);
  const [consensi, setConsensi] = useState({});
  const [password, setPassword] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Ogni apertura riparte da capo, con quello che si sa già del contatto.
  useEffect(() => {
    if (!aperto) return;
    setPasso(0);
    setFoto({ file: null, rimossa: false });
    setAbbonamento(INIZIO);
    setCertificato({ file: null, expiry_date: spostaGiorni(oggiIso(), 365) });
    setPrivacy(false);
    setConsensi({});
    setPassword(generaPasswordTemporanea());
    setAnagrafica(lead ? {
      ...ANAGRAFICA_VUOTA, nome: lead.nome ?? "", cognome: lead.cognome ?? "", sesso: lead.sesso ?? "",
      email: lead.email ?? "", phone: lead.telefono ?? "",
      // La nota del contatto diventa la prima nota del socio: è la stessa segreteria che la legge.
      notes: lead.note ?? "",
    } : ANAGRAFICA_VUOTA);
    // Un ex socio ha già una scheda: si riparte da quella, che ha codice fiscale e data di nascita.
    if (lead?.socio_id) api.entities.Member.get(lead.socio_id).then((s) => setAnagrafica(anagraficaDi(s))).catch(() => {});
    api.entities.Plan.list().then((elenco) => setTipi(elenco.filter((p) => !motivoNonVendibile(p)))).catch(() => setTipi([]));
  }, [aperto, lead]);

  const tipo = tipi.find((p) => p.id === abbonamento.plan_id);
  const scadenza = tipo ? dataFineAbbonamento(abbonamento.start_date, tipo.durata_valore, tipo.durata_unita) : null;
  const conEmail = Boolean(anagrafica.email.trim());
  const incompleto = motivoAnagraficaIncompleta(anagrafica);
  const corrente = PASSI[passo];
  const ultimo = passo === PASSI.length - 1;
  // Si va avanti solo con il passo completo; i facoltativi si saltano.
  const bloccato = (corrente.valore === "anagrafica" && incompleto)
    || (corrente.valore === "privacy" && !privacy)
    || (corrente.valore === "certificato" && certificato.file && !certificato.expiry_date);

  const salta = () => {
    if (corrente.valore === "abbonamento") setAbbonamento(INIZIO);
    if (corrente.valore === "certificato") setCertificato((c) => ({ ...c, file: null }));
    // L'ultimo passo saltato è "iscrivi senza accesso": si conferma subito, senza aspettare lo stato.
    if (ultimo) conferma({ senzaAccesso: true }); else setPasso((p) => p + 1);
  };

  async function conferma({ senzaAccesso = false } = {}) {
    setSalvando(true);
    try {
      // I file si caricano prima: il server riceve solo il loro indirizzo.
      // ponytail: se poi l'iscrizione fallisce i file restano orfani; li toglie `npm run manutenzione:file-orfani`.
      const foto_url = foto.file ? (await caricaFile({ file: foto.file })).file_url : undefined;
      const doc = certificato.file ? await caricaFile({ file: certificato.file }) : null;
      const accesso = password && conEmail && !senzaAccesso ? { password } : undefined;
      const { member, riattivato, accesso_portale: portale } = await api.iscrivi({
        lead_id: lead?.id,
        anagrafica: { ...anagrafica, ...(foto_url ? { foto_url } : {}) },
        abbonamento: tipo ? { plan_id: tipo.id, start_date: abbonamento.start_date } : undefined,
        certificato: doc ? { file_url: doc.file_url, file_name: doc.file_name ?? certificato.file.name, expiry_date: certificato.expiry_date } : undefined,
        informativa_privacy: privacy,
        consensi: Object.keys(consensi).length ? consensi : undefined,
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
          <DialogTitle>Iscrivi{lead ? ` ${lead.nome}` : ""}</DialogTitle>
          <DialogDescription>
            {lead?.socio_id
              ? "È già stato socio: controlla i dati della sua scheda. Alla fine torna socio, con il suo codice e la sua storia."
              : "Si salva tutto insieme alla fine: nessun socio resta a metà."}
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
              <CampiAnagrafica valori={anagrafica} onChange={setAnagrafica}
                suggerimentoNascita={lead?.anno_nascita ? `Il contatto aveva indicato il ${lead.anno_nascita}.` : null} />
              {!lead?.socio_id && <SceltaFoto socio={anagrafica} file={foto.file} onChange={setFoto} />}
              {incompleto && <p className="text-xs text-muted-foreground">{incompleto}</p>}
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
              {scadenza && <p className="text-sm text-muted-foreground">Scade il {formatData(scadenza, "media")}. L'incasso resta in reception, come sempre.</p>}
            </div>
          )}

          {corrente.valore === "certificato" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="iscrivi-certificato">Certificato medico (foto o file)</Label>
                {/* `capture` apre la fotocamera sul telefono; dal computer si sceglie un file. */}
                <Input id="iscrivi-certificato" type="file" accept="image/*,application/pdf" capture="environment"
                  onChange={(e) => setCertificato((c) => ({ ...c, file: e.target.files?.[0] ?? null }))} />
              </div>
              <div>
                <Label htmlFor="iscrivi-scadenza">Scade il</Label>
                <Input id="iscrivi-scadenza" type="date" min={oggiIso()} value={certificato.expiry_date} onChange={(e) => setCertificato((c) => ({ ...c, expiry_date: e.target.value }))} />
              </div>
              <p className="text-xs text-muted-foreground">Se lo porta dopo, salta: il socio vedrà l'avviso nel portale.</p>
            </div>
          )}

          {corrente.valore === "privacy" && (
            <div className="space-y-4">
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={privacy} onCheckedChange={(v) => setPrivacy(v === true)} className="mt-0.5" aria-label="Informativa privacy firmata" />
                <span><span className="font-medium">Ha ricevuto e firmato l'informativa privacy.</span> Serve per iscriversi.</span>
              </label>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Comunicazioni promozionali (facoltative, dal modulo firmato)</legend>
                {TIPI_CONSENSO.map((c) => (
                  <label key={c.valore} className="flex items-center gap-3 text-sm">
                    <Checkbox checked={consensi[c.valore] === true} onCheckedChange={(v) => setConsensi((s) => ({ ...s, [c.valore]: v === true }))} aria-label={c.etichetta} />
                    {c.etichetta}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">Il socio le può cambiare quando vuole dal portale.</p>
              </fieldset>
            </div>
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

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => (passo ? setPasso((p) => p - 1) : onChiudi(false))} disabled={salvando}>
              {passo ? "Indietro" : "Annulla"}
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              {corrente.facoltativo && <Button type="button" variant="ghost" onClick={salta} disabled={salvando}>Salta</Button>}
              <Button type="submit" disabled={Boolean(bloccato) || salvando}>
                {salvando ? "Iscrizione..." : ultimo ? (lead?.socio_id ? "Riattiva il socio" : "Iscrivi") : "Avanti"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
