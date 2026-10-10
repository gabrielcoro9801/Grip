import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatData, formatDataOra } from "@/core/domain/format";
import { TIPI_CONSENSO } from "@/core/domain/consensi";
import { NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { Megaphone } from "lucide-react";

const FONTI = { portale: "dal portale", reception: "in reception", form: "dal modulo online", disiscrizione: "dal link nel messaggio" };
const etichetta = (tipo) => TIPI_CONSENSO.find((t) => t.valore === tipo)?.etichetta ?? tipo;

/** Il dialogo per registrare: un consenso con il suo modulo firmato, o una revoca con il motivo. */
function Registra({ modo, socio, consensi, moduli, onChiudi, onFatto }) {
  const { toast } = useToast();
  const dare = modo === "dai";
  // Si propongono solo i canali che cambiano: dare quelli spenti, togliere quelli accesi.
  const proponibili = TIPI_CONSENSO.filter((t) => Boolean(consensi[t.valore]?.valore) !== dare);
  const [tipi, setTipi] = useState([]);
  const [documento, setDocumento] = useState(moduli[0]?.id ?? "");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const manca = !tipi.length || (dare ? !documento : !nota.trim());
  const conferma = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.persone.registraConsensi(socio.persona_id, {
        tipi, valore: dare, documento_id: dare ? documento : undefined, nota: nota.trim() || undefined,
        atteso: Object.fromEntries(tipi.map((t) => [t, consensi[t]?.il ?? null])),
      });
      toast({ title: dare ? "Consenso registrato" : "Consenso tolto", description: tipi.map(etichetta).join(", ") });
      onFatto();
      onChiudi();
    } catch (err) {
      toast({ title: "Non registrato", description: err.message, variant: "destructive" });
      // Il socio ha appena cambiato idea dal portale: si rilegge, e si decide su quello vero.
      if (err.status === 409) { onFatto(); onChiudi(); }
    }
    setSalvando(false);
  };

  return (
    <form onSubmit={conferma} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{dare ? "Registra un consenso firmato" : "Registra una revoca"}</DialogTitle>
        <DialogDescription>
          {dare
            ? "Vale solo con il modulo firmato fra i documenti del socio: se il documento viene eliminato, il consenso decade."
            : "Per esempio quando il socio lo chiede per email o di persona. Dal portale può toglierlo da solo, quando vuole."}
        </DialogDescription>
      </DialogHeader>
      {proponibili.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dare ? "Ha già dato il consenso per tutti i canali." : "Non ha nessun consenso da togliere."}</p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Per quali comunicazioni</legend>
          {proponibili.map((t) => (
            <label key={t.valore} className="flex items-center gap-3 text-sm">
              <Checkbox checked={tipi.includes(t.valore)} onCheckedChange={(v) => setTipi((s) => (v === true ? [...s, t.valore] : s.filter((x) => x !== t.valore)))} aria-label={t.etichetta} />
              {t.etichetta}
            </label>
          ))}
        </fieldset>
      )}
      {dare && (moduli.length ? (
        <div>
          <Label>Il modulo firmato</Label>
          <Select value={documento} onValueChange={setDocumento}>
            <SelectTrigger aria-label="Il modulo firmato"><SelectValue placeholder="Scegli" /></SelectTrigger>
            <SelectContent>
              {moduli.map((d) => <SelectItem key={d.id} value={d.id}>{d.file_name || "Modulo"} · caricato il {formatData(d.created_date, "breve")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm rounded-lg bg-warning/10 px-3 py-2">
          Prima carica il modulo firmato fra i <span className="font-medium">Documenti</span> del socio, con il tipo «Consenso comunicazioni promozionali».
        </p>
      ))}
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="consenso-nota">{dare ? "Nota" : "Perché *"}</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{nota.length}/{NOTA_DIARIO_MASSIMO}</span>
        </div>
        <Textarea id="consenso-nota" rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none" value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder={dare ? "" : "Es. l'ha chiesto per email il 10/10"} />
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="outline" onClick={onChiudi} disabled={salvando}>Annulla</Button>
        <Button type="submit" disabled={manca || salvando}>{salvando ? "Salvataggio..." : "Registra"}</Button>
      </div>
    </form>
  );
}

/**
 * Le comunicazioni promozionali del socio, in sola lettura: per ogni canale se c'è il consenso,
 * da dove e da quando, e il registro intero (la prova). Cambiarle dalla scheda è un atto voluto,
 * non una casella: un consenso si registra solo con il modulo firmato già caricato, una revoca
 * con il motivo. Il socio sceglie anche dal portale, nello stesso registro: se l'ha appena fatto,
 * il server lo dice (409) invece di scrivere sopra la sua scelta.
 *
 * @param documenti i documenti del socio: i moduli firmati sono quelli `consenso_marketing`
 */
export default function ConsensiSocio({ socio, documenti = [], puoModificare, onCambio }) {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const [storico, setStorico] = useState(false);
  const [modo, setModo] = useState(null); // "dai" | "togli"

  const carica = useCallback(() => {
    setErrore(null);
    api.persone.consensi(socio.persona_id).then(setDati).catch(setErrore);
  }, [socio.persona_id]);
  useEffect(() => { carica(); }, [carica, documenti]);

  const moduli = documenti.filter((d) => d.document_type === "consenso_marketing");

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><Megaphone className="w-4 h-4" /> Comunicazioni promozionali</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {errore && <p className="text-sm text-destructive">{errore.message}</p>}
        {!dati && !errore && <p className="text-sm text-muted-foreground">Caricamento…</p>}
        {dati && (
          <>
            <dl className="space-y-2">
              {TIPI_CONSENSO.map((t) => {
                const c = dati.consensi[t.valore];
                return (
                  <div key={t.valore} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <dt>{t.etichetta}</dt>
                    <dd className={c.valore ? "font-medium text-success" : "text-muted-foreground"}>
                      {c.valore ? "Sì" : c.senza_prova ? "No: il modulo firmato non c'è più" : "No"}
                      {c.il && <span className="font-normal text-xs text-muted-foreground"> · {FONTI[c.fonte] ?? ""} il {formatData(c.il, "breve")}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-xs text-muted-foreground">Il socio le sceglie dal portale. Le comunicazioni di servizio (scadenze, lezioni annullate) gli arrivano comunque.</p>

            <div className="flex flex-wrap gap-2">
              {dati.storico.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setStorico((v) => !v)}>
                  {storico ? "Nascondi lo storico" : `Storico (${dati.storico.length})`}
                </Button>
              )}
              {puoModificare && (
                <>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setModo("dai")}>Registra consenso firmato</Button>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setModo("togli")}>Registra revoca</Button>
                </>
              )}
            </div>

            {storico && (
              <ol className="space-y-2 border-t border-border pt-3">
                {dati.storico.map((r) => (
                  <li key={r.id} className="text-xs">
                    <span className="font-medium">{etichetta(r.tipo)}: {r.valore ? "dato" : "tolto"}</span>
                    <span className="text-muted-foreground"> {FONTI[r.fonte] ?? r.fonte} · {formatDataOra(r.created_date)} · {r.autore_nome || "—"}</span>
                    {r.fonte === "reception" && r.valore && (
                      <span className="block text-muted-foreground">Modulo: {r.documento_presente ? (r.documento_nome || "caricato") : "eliminato — il consenso non vale più"}</span>
                    )}
                    {r.nota && <span className="block text-muted-foreground">«{r.nota}»</span>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!modo} onOpenChange={(v) => { if (!v) setModo(null); }}>
        <DialogContent className="max-w-md">
          {modo && dati && (
            <Registra key={modo} modo={modo} socio={socio} consensi={dati.consensi} moduli={moduli}
              onChiudi={() => setModo(null)} onFatto={() => { carica(); onCambio?.(); }} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
