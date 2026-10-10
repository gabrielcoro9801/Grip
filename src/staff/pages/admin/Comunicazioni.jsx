import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/core/api/client";
import PageHeader from "@/staff/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/ui/primitivi/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitivi/tabs";
import { Button } from "@/ui/primitivi/button";
import { Input } from "@/ui/primitivi/input";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState, EmptyState } from "@/ui/StateViews";
import { useToast } from "@/ui/primitivi/use-toast";
import { etichettaCanale, statoMessaggio, STATI_PLAYBOOK, playbook as playbookDi } from "@/core/domain/comunicazioni";
import { CheckCircle2, Circle, FlaskConical, Power, Send, Inbox } from "lucide-react";

// La sezione Comunicazioni: l'amministratore configura i canali, rilegge i testi, guarda
// l'anteprima e solo alla fine accende. Le regole stanno in shared/comunicazioni.js, gli invii in
// server/src/lib/invii.js: qui si mostra, si chiede, e ogni scrittura restituisce la sezione intera.

const TONO_CANALE = { non_configurato: "neutro", da_verificare: "attesa", pronto: "positivo" };
const ETICHETTA_CANALE = { non_configurato: "Non configurato", da_verificare: "Da verificare", pronto: "Pronto" };
const TONO_PLAYBOOK = { spento: "neutro", anteprima: "info", attivo: "positivo" };
const euro = (cent) => `${(Number(cent || 0) / 100).toFixed(2).replace(".", ",")} €`;
const dataOra = (iso) => (iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "");

/** Esegue una scrittura, aggiorna la sezione e dice com'è andata. */
function useScrittura(setDati) {
  const { toast } = useToast();
  return useCallback(async (azione, riuscita) => {
    try {
      const dati = await azione();
      if (dati?.canali) setDati(dati);
      if (riuscita) toast({ title: riuscita });
      return dati;
    } catch (err) {
      toast({ title: "Non salvato", description: err.message, variant: "destructive" });
      return null;
    }
  }, [setDati, toast]);
}

export default function Comunicazioni() {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const scrivi = useScrittura(setDati);

  const carica = useCallback(async () => {
    setErrore(null);
    try { setDati(await api.comunicazioni.leggi()); } catch (err) { setErrore(err); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!dati) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Comunicazioni"
        description="Messaggi automatici ai soci: arrivano spenti, si configurano, si provano in anteprima e solo alla fine si accendono"
      />

      {!dati.invii_reali && (
        <div role="status" className="flex gap-3 rounded-lg border border-info/30 bg-info/10 p-4 text-sm">
          <FlaskConical className="h-5 w-5 shrink-0 text-info" aria-hidden="true" />
          <p>
            <strong>Modalità simulazione.</strong> Questo server non manda messaggi veri: puoi configurare tutto, verificare i canali e
            guardare le anteprime, ma ogni messaggio resta «simulato». Gli invii veri si accendono sul server (INVII_REALI).
          </p>
        </div>
      )}

      <Tabs defaultValue="stato">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="stato">Stato</TabsTrigger>
          <TabsTrigger value="canali">Canali</TabsTrigger>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="registro">Registro</TabsTrigger>
        </TabsList>
        <TabsContent value="stato" className="mt-4 space-y-4">
          <Interruttore dati={dati} scrivi={scrivi} />
          <Regole dati={dati} scrivi={scrivi} />
        </TabsContent>
        <TabsContent value="canali" className="mt-4 space-y-4">
          {dati.canali.map((c) => <Canale key={c.canale} canale={c} dati={dati} scrivi={scrivi} />)}
        </TabsContent>
        <TabsContent value="playbook" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Ogni playbook parte da una cosa da fare: quando scatta lo decidono le soglie, e un segnale spento non manda niente.{" "}
            <Link to="/admin/da-fare" className="text-primary hover:underline">Impostazioni di Da fare</Link>
          </p>
          {dati.playbook.map((p) => <Playbook key={p.codice} pb={p} dati={dati} scrivi={scrivi} />)}
        </TabsContent>
        <TabsContent value="registro" className="mt-4">
          <Registro />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Stato: la lista di controllo e l'interruttore generale --------------------------------

function Interruttore({ dati, scrivi }) {
  const { lista } = dati;
  const conferma = (voce, fatta) => scrivi(() => api.comunicazioni.conferma(voce, fatta));
  const confermabili = { informativa: dati.informativa, testi: dati.testi_rivisti };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className="h-5 w-5" aria-hidden="true" />
          Comunicazioni {dati.attive ? "accese" : "spente"}
        </CardTitle>
        <CardDescription>
          L'interruttore si accende solo con la lista di controllo completa. Anche accese, partono soltanto i playbook in «Attivo».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2" aria-label="Lista di controllo">
          {lista.voci.map((v) => (
            <li key={v.codice} className="flex flex-wrap items-center gap-2 text-sm">
              {v.fatta
                ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Fatto" />
                : <Circle className="h-4 w-4 text-muted-foreground" aria-label="Da fare" />}
              <span>{v.etichetta}</span>
              {v.codice in confermabili && (
                confermabili[v.codice]
                  ? <span className="text-xs text-muted-foreground">confermato da {confermabili[v.codice].da} il {dataOra(confermabili[v.codice].il)} · <button type="button" className="underline" onClick={() => conferma(v.codice, false)}>togli</button></span>
                  : <Button size="sm" variant="outline" onClick={() => conferma(v.codice, true)}>Confermo</Button>
              )}
            </li>
          ))}
        </ul>
        {dati.attive
          ? <Button variant="outline" onClick={() => scrivi(() => api.comunicazioni.interruttore(false), "Comunicazioni spente")}>Spegni tutte le comunicazioni</Button>
          : <Button disabled={!lista.completa} onClick={() => scrivi(() => api.comunicazioni.interruttore(true), "Comunicazioni accese")}>Accendi le comunicazioni</Button>}
      </CardContent>
    </Card>
  );
}

function Regole({ dati, scrivi }) {
  const [f, setF] = useState({
    dalle: dati.silenzio.dalle, alle: dati.silenzio.alle,
    budget: (dati.budget_sms_centesimi / 100).toString(), costo: String(dati.costo_sms_centesimi),
  });
  const salva = () => scrivi(() => api.comunicazioni.regole({
    silenzio: { dalle: Number(f.dalle), alle: Number(f.alle) },
    budget_sms_centesimi: Math.round(Number(String(f.budget).replace(",", ".")) * 100),
    costo_sms_centesimi: Number(f.costo),
  }), "Regole salvate");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Regole</CardTitle>
        <CardDescription>Quando si tace, e quanto si può spendere in SMS ogni mese. Il budget è un tetto: raggiunto, gli SMS si fermano.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Fascia di silenzio</legend>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="silenzio-dalle">dalle</Label>
              <Input id="silenzio-dalle" type="number" min={0} max={23} className="w-20" value={f.dalle} onChange={(e) => setF({ ...f, dalle: e.target.value })} />
              <Label htmlFor="silenzio-alle">alle</Label>
              <Input id="silenzio-alle" type="number" min={0} max={23} className="w-20" value={f.alle} onChange={(e) => setF({ ...f, alle: e.target.value })} />
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="budget-sms">Budget SMS al mese (€)</Label>
            <Input id="budget-sms" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
            <p className="text-xs text-muted-foreground">Speso questo mese: {euro(dati.spesa_sms_mese)}. Zero vuol dire nessun SMS.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="costo-sms">Costo di un SMS (centesimi)</Label>
            <Input id="costo-sms" type="number" min={0} value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} />
          </div>
        </div>
        <Button onClick={salva}>Salva le regole</Button>
      </CardContent>
    </Card>
  );
}

// --- Canali ----------------------------------------------------------------------------------

function Canale({ canale, dati, scrivi }) {
  const { toast } = useToast();
  const [conf, setConf] = useState({ ...canale.conf });
  const [segreto, setSegreto] = useState("");
  const [a, setA] = useState("");
  const [prova, setProva] = useState(null);
  const [codice, setCodice] = useState("");
  useEffect(() => { setConf({ ...canale.conf }); }, [canale.conf]);

  if (canale.canale === "app") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">{canale.etichetta} <StatusBadge tone={TONO_CANALE[canale.stato]} label={ETICHETTA_CANALE[canale.stato]} /></CardTitle>
          <CardDescription>Il messaggio arriva nelle notifiche del portale soci: non costa niente e non disturba. Serve che il socio abbia l'accesso al portale.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant={canale.conf.attivo ? "outline" : "default"}
            onClick={() => scrivi(() => api.comunicazioni.canale("app", { attivo: !canale.conf.attivo }), canale.conf.attivo ? "Notifiche nel portale disattivate" : "Notifiche nel portale attivate")}>
            {canale.conf.attivo ? "Disattiva" : "Attiva le notifiche nel portale"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const fornitore = canale.fornitori.find((x) => x.valore === conf.fornitore);
  const campo = (nome, etichetta, extra = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`${canale.canale}-${nome}`}>{etichetta}</Label>
      <Input id={`${canale.canale}-${nome}`} value={conf[nome] ?? ""} onChange={(e) => setConf({ ...conf, [nome]: e.target.value })} {...extra} />
    </div>
  );
  const salva = () => scrivi(() => api.comunicazioni.canale(canale.canale, { ...conf, segreto: segreto || undefined }), `${canale.etichetta}: configurazione salvata`)
    .then((r) => { if (r) setSegreto(""); });
  const inviaProva = async () => {
    try {
      const r = await api.comunicazioni.prova(canale.canale, a || undefined);
      setProva(r);
      toast({ title: r.simulato ? "Prova simulata" : `Prova inviata a ${r.a}`, description: r.simulato ? "Il messaggio è qui sotto: copia il codice." : "Controlla la posta e riscrivi il codice." });
    } catch (err) {
      toast({ title: "Prova non riuscita", description: err.message, variant: "destructive" });
    }
  };
  const verifica = () => scrivi(() => api.comunicazioni.verifica(canale.canale, codice), `${canale.etichetta}: verificato`)
    .then((r) => { if (r) { setProva(null); setCodice(""); } });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">{canale.etichetta} <StatusBadge tone={TONO_CANALE[canale.stato]} label={ETICHETTA_CANALE[canale.stato]} /></CardTitle>
        <CardDescription>
          {canale.canale === "email"
            ? "La casella della palestra (SMTP) costa zero e scrive col vostro indirizzo; Brevo è un servizio di invio con un piano gratuito da 300 email al giorno."
            : "Per ora c'è solo il fornitore simulato: un operatore SMS vero (e il mittente registrato secondo AGCOM) si aggiungerà quando servirà."}
          {canale.verificato && <> Verificato da {canale.verificato.da} il {dataOra(canale.verificato.il)}{canale.verificato.reale ? "" : " (in simulazione)"}.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${canale.canale}-fornitore`}>Fornitore</Label>
            <Select value={conf.fornitore ?? ""} onValueChange={(v) => setConf({ ...conf, fornitore: v })}>
              <SelectTrigger id={`${canale.canale}-fornitore`}><SelectValue placeholder="Scegli…" /></SelectTrigger>
              <SelectContent>{canale.fornitori.map((x) => <SelectItem key={x.valore} value={x.valore}>{x.etichetta}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {fornitore?.campi.includes("mittente") && campo("mittente", canale.canale === "email" ? "Indirizzo del mittente" : "Mittente (max 11 caratteri)")}
          {fornitore?.campi.includes("nome_mittente") && campo("nome_mittente", "Nome del mittente")}
          {fornitore?.campi.includes("host") && campo("host", "Server SMTP", { placeholder: "smtp.gmail.com" })}
          {fornitore?.campi.includes("porta") && campo("porta", "Porta", { inputMode: "numeric", placeholder: "587" })}
          {fornitore?.campi.includes("utente") && campo("utente", "Utente della casella")}
          {fornitore?.segreto && (
            <div className="space-y-1">
              <Label htmlFor={`${canale.canale}-segreto`}>{fornitore.segreto}</Label>
              <Input id={`${canale.canale}-segreto`} type="password" autoComplete="new-password" value={segreto} onChange={(e) => setSegreto(e.target.value)}
                placeholder={canale.segreto.impostato ? "Impostata: lascia vuoto per non cambiarla" : ""} disabled={!dati.cifratura} />
              {!dati.cifratura && <p className="text-xs text-destructive">Manca CHIAVE_SEGRETI sul server: le credenziali non si possono salvare.</p>}
            </div>
          )}
        </div>
        <Button onClick={salva} disabled={!fornitore}>Salva la configurazione</Button>

        {canale.stato !== "non_configurato" && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Invio di prova</p>
            <p className="text-xs text-muted-foreground">Ti mandiamo un codice di sei cifre: riscrivilo qui per confermare che i messaggi arrivano.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1 grow sm:grow-0 sm:w-64">
                <Label htmlFor={`${canale.canale}-a`}>{canale.canale === "email" ? "A quale indirizzo (vuoto: il tuo)" : "A quale numero"}</Label>
                <Input id={`${canale.canale}-a`} value={a} onChange={(e) => setA(e.target.value)} />
              </div>
              <Button variant="outline" onClick={inviaProva}><Send className="mr-1 h-4 w-4" aria-hidden="true" />Invia la prova</Button>
            </div>
            {prova?.testo && (
              <div className="rounded-md bg-muted p-3 text-sm" aria-label="Messaggio simulato">
                <p className="text-xs text-muted-foreground mb-1">Messaggio simulato (non è partito niente):</p>
                {prova.testo}
              </div>
            )}
            {(prova || canale.prova_in_corso) && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1 w-40">
                  <Label htmlFor={`${canale.canale}-codice`}>Codice ricevuto</Label>
                  <Input id={`${canale.canale}-codice`} inputMode="numeric" value={codice} onChange={(e) => setCodice(e.target.value)} />
                </div>
                <Button onClick={verifica} disabled={codice.trim().length !== 6}>Verifica</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Playbook --------------------------------------------------------------------------------

function Playbook({ pb, dati, scrivi }) {
  const [anteprima, setAnteprima] = useState(false);
  const [testi, setTesti] = useState(false);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="font-medium flex flex-wrap items-center gap-2">
              {pb.titolo}
              <StatusBadge tone={TONO_PLAYBOOK[pb.stato]} label={STATI_PLAYBOOK.find((s) => s.valore === pb.stato)?.etichetta} />
              <span className="text-xs text-muted-foreground">{pb.tipo === "marketing" ? "promozionale: solo con il consenso" : "di servizio"}</span>
            </p>
            <p className="text-sm text-muted-foreground">{pb.quando}</p>
            <p className="text-xs text-muted-foreground">Canali: {pb.canali.map(etichettaCanale).join(" → ")}</p>
          </div>
          <div role="group" aria-label={`Stato di ${pb.titolo}`} className="inline-flex rounded-md border overflow-hidden">
            {STATI_PLAYBOOK.map((s) => (
              <button key={s.valore} type="button" aria-pressed={pb.stato === s.valore}
                className={`px-3 py-1.5 text-sm ${pb.stato === s.valore ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => pb.stato !== s.valore && scrivi(() => api.comunicazioni.playbook(pb.codice, s.valore), `${pb.titolo}: ${s.etichetta.toLowerCase()}`)}>
                {s.etichetta}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!pb.immediato && <Button size="sm" variant="outline" onClick={() => setAnteprima(true)}>Anteprima di domani</Button>}
          <Button size="sm" variant="outline" onClick={() => setTesti(true)}>Testi</Button>
        </div>
      </CardContent>
      {anteprima && <AnteprimaDomani pb={pb} onChiudi={() => setAnteprima(false)} />}
      {testi && <Testi pb={pb} dati={dati} scrivi={scrivi} onChiudi={() => setTesti(false)} />}
    </Card>
  );
}

function AnteprimaDomani({ pb, onChiudi }) {
  const [r, setR] = useState(null);
  const [errore, setErrore] = useState(null);
  useEffect(() => { api.comunicazioni.anteprima(pb.codice).then(setR, setErrore); }, [pb.codice]);
  return (
    <Dialog open onOpenChange={(o) => !o && onChiudi()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Anteprima: {pb.titolo}</DialogTitle>
          <DialogDescription>Calcolata per domani, come se il playbook fosse attivo. Non parte niente.</DialogDescription>
        </DialogHeader>
        {errore && <p className="text-sm text-destructive">{errore.message}</p>}
        {!r && !errore && <LoadingState />}
        {r && (
          <div className="space-y-3">
            <p className="text-lg font-medium" data-testid="totale-anteprima">
              Domani sarebbero partiti {r.totale} {r.totale === 1 ? "messaggio" : "messaggi"}
            </p>
            <p className="text-sm text-muted-foreground">
              {Object.entries(r.per_canale).map(([c, n]) => `${n} ${etichettaCanale(c).toLowerCase()}`).join(" · ") || "nessuno"}
              {r.bloccati ? ` · ${r.bloccati} bloccati (consenso, età o budget)` : ""}
              {r.senza_canale ? ` · ${r.senza_canale} senza un canale pronto` : ""}
            </p>
            {r.esempi.map((e) => (
              <div key={`${e.persona_id}-${e.canale}`} className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium flex flex-wrap items-center gap-2">
                  {e.nome} <span className="text-xs text-muted-foreground">{etichettaCanale(e.canale)}</span>
                  {e.stato !== "ok" && <StatusBadge tone="attesa" label={statoMessaggio(e.stato).etichetta} />}
                </p>
                {e.motivo && <p className="text-xs text-muted-foreground">{e.motivo}</p>}
                {e.oggetto && <p className="font-medium">{e.oggetto}</p>}
                <p className="whitespace-pre-line">{e.testo}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Testi({ pb, dati, scrivi, onChiudi }) {
  const [canale, setCanale] = useState(pb.canali[0]);
  const [bozza, setBozza] = useState(pb.testi[canale]);
  const [cerca, setCerca] = useState("");
  const [trovati, setTrovati] = useState([]);
  const [persona, setPersona] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  useEffect(() => { setBozza(pb.testi[canale]); }, [pb, canale]);

  // L'anteprima del testo come uscirebbe, anche prima di salvarlo, per una persona vera o per l'esempio.
  useEffect(() => {
    const t = setTimeout(() => {
      api.comunicazioni.anteprimaTesto({ playbook: pb.codice, canale, persona_id: persona?.persona_id, oggetto: bozza.oggetto, testo: bozza.testo })
        .then(setAnteprima, () => setAnteprima(null));
    }, 300);
    return () => clearTimeout(t);
  }, [pb.codice, canale, bozza, persona]);

  useEffect(() => {
    if (cerca.trim().length < 2) { setTrovati([]); return undefined; }
    const t = setTimeout(() => api.persone.cerca(cerca).then((r) => setTrovati(r.risultati.filter((x) => x.socio_id).slice(0, 5)), () => setTrovati([])), 250);
    return () => clearTimeout(t);
  }, [cerca]);

  const limite = canale === "sms" ? dati.limiti.sms : dati.limiti.testo;
  return (
    <Dialog open onOpenChange={(o) => !o && onChiudi()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Testi: {pb.titolo}</DialogTitle>
          <DialogDescription>
            Segnaposto: {Object.keys(dati.segnaposto).map((s) => `{${s}}`).join(" ")}.
            {playbookDi(pb.codice)?.tipo === "marketing" && " Alle email e agli SMS promozionali si aggiunge da solo il link per non riceverli più."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Canale">
          {pb.canali.map((c) => (
            <Button key={c} size="sm" variant={c === canale ? "default" : "outline"} aria-pressed={c === canale} onClick={() => setCanale(c)}>
              {etichettaCanale(c)}{pb.testi[c].personalizzato ? " ·" : ""}
            </Button>
          ))}
        </div>
        <div className="space-y-3">
          {canale !== "sms" && (
            <div className="space-y-1">
              <Label htmlFor="testo-oggetto">Oggetto (è anche il titolo della notifica)</Label>
              <Input id="testo-oggetto" value={bozza.oggetto} onChange={(e) => setBozza({ ...bozza, oggetto: e.target.value })} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="testo-corpo">Testo</Label>
            <Textarea id="testo-corpo" rows={canale === "sms" ? 3 : 6} value={bozza.testo} onChange={(e) => setBozza({ ...bozza, testo: e.target.value })} />
            <p className={`text-xs ${bozza.testo.length > limite ? "text-destructive" : "text-muted-foreground"}`}>{bozza.testo.length} / {limite} caratteri</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => scrivi(() => api.comunicazioni.salvaTesto(pb.codice, canale, bozza), "Testo salvato")}>Salva il testo</Button>
            {pb.testi[canale].personalizzato && (
              <Button variant="outline" onClick={() => scrivi(() => api.comunicazioni.testoPredefinito(pb.codice, canale), "Tornato al testo predefinito")}>Torna al predefinito</Button>
            )}
          </div>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="anteprima-persona">Anteprima su un socio vero</Label>
            <Input id="anteprima-persona" placeholder="Cerca per nome, telefono o codice…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
            {trovati.length > 0 && (
              <ul className="rounded-md border divide-y text-sm">
                {trovati.map((x) => (
                  <li key={x.persona_id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => { setPersona(x); setCerca(""); setTrovati([]); }}>{x.nome}</button></li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{persona ? `Per ${persona.nome} · ` : "Con i dati d'esempio · "}{persona && <button type="button" className="underline" onClick={() => setPersona(null)}>usa l'esempio</button>}</p>
          </div>
          {anteprima && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1" aria-label="Anteprima del messaggio">
              {anteprima.oggetto && <p className="font-medium">{anteprima.oggetto}</p>}
              <p className="whitespace-pre-line">{anteprima.testo}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Registro --------------------------------------------------------------------------------

function Registro() {
  const [mese, setMese] = useState(new Date().toISOString().slice(0, 7));
  const [r, setR] = useState(null);
  const [errore, setErrore] = useState(null);
  useEffect(() => { setR(null); api.comunicazioni.messaggi(mese).then(setR, setErrore); }, [mese]);
  if (errore) return <ErrorState error={errore} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registro dei messaggi</CardTitle>
        <CardDescription>Cosa è partito, cosa sarebbe partito (simulato) e cosa è stato bloccato, con il perché.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="registro-mese">Mese</Label>
            <Input id="registro-mese" type="month" value={mese} onChange={(e) => e.target.value && setMese(e.target.value)} className="w-44" />
          </div>
          {r && <p className="text-sm text-muted-foreground">Spesa SMS del mese: {euro(r.costo_sms)}</p>}
        </div>
        {!r ? <LoadingState /> : r.messaggi.length === 0 ? (
          <EmptyState icon={Inbox} title="Nessun messaggio" description="In questo mese i playbook non hanno scritto niente." />
        ) : (
          <>
            <p className="text-sm flex flex-wrap gap-2">
              {Object.entries(r.conti).map(([s, n]) => <StatusBadge key={s} tone={statoMessaggio(s).tono} label={`${statoMessaggio(s).etichetta}: ${n}`} />)}
            </p>
            <ul className="divide-y rounded-md border">
              {r.messaggi.map((m) => (
                <li key={m.id} className="p-3 text-sm space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.nome ?? "—"}</span>
                    <span className="text-muted-foreground">{playbookDi(m.playbook)?.titolo ?? m.playbook} · {etichettaCanale(m.canale)}</span>
                    <StatusBadge tone={statoMessaggio(m.stato).tono} label={statoMessaggio(m.stato).etichetta} />
                    <span className="text-xs text-muted-foreground ml-auto">{dataOra(m.inviato_il ?? m.created_date)}</span>
                  </p>
                  {m.motivo && <p className="text-xs text-muted-foreground">{m.motivo}</p>}
                  <p className="text-muted-foreground line-clamp-2">{m.oggetto ? `${m.oggetto} — ` : ""}{m.testo}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
