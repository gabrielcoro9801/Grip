import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Textarea } from "@/ui/primitivi/textarea";
import { Checkbox } from "@/ui/primitivi/checkbox";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra, formatData } from "@/core/domain/format";
import { descriviAttivita, NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { linkWhatsApp } from "@/core/domain/anagrafica";
import { TIPI_CONSENSO } from "@/core/domain/consensi";
import { BookOpen, Phone, MessageCircle, Mail, Bot } from "lucide-react";

// Quante righe si vedono prima di "mostra tutto": le ultime sono quelle che servono prima di
// richiamare.
const RIGHE_VISIBILI = 6;
const FONTI = { portale: "dal portale", reception: "in reception", form: "dal modulo online" };

/**
 * Il diario del socio nella sua scheda: come contattarlo con un clic, che cosa è successo (dai
 * tempi in cui era un contatto, se lo era), le note della segreteria e i consensi promozionali.
 */
export default function DiarioSocio({ socio, puoModificare }) {
  const { toast } = useToast();
  const [diario, setDiario] = useState(null);
  const [errore, setErrore] = useState(null);
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [tutto, setTutto] = useState(false);

  const carica = useCallback(() => {
    setErrore(null);
    api.persone.diario(socio.persona_id).then(setDiario).catch(setErrore);
  }, [socio.persona_id]);
  useEffect(() => { carica(); }, [carica]);

  const aggiungiNota = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.persone.nota(socio.persona_id, nota);
      setNota("");
      carica();
    } catch (err) {
      toast({ title: "Nota non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  const scegliConsenso = async (tipo, valore) => {
    try {
      const { consensi } = await api.persone.consenso(socio.persona_id, tipo, valore);
      setDiario((d) => ({ ...d, consensi }));
    } catch (err) {
      toast({ title: "Consenso non registrato", description: err.message, variant: "destructive" });
    }
  };

  const whatsapp = linkWhatsApp(socio.phone, `Ciao ${socio.nome}!`);
  const righe = diario ? [...diario.attivita].reverse() : [];
  const visibili = tutto ? righe : righe.slice(0, RIGHE_VISIBILI);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><BookOpen className="w-4 h-4" /> Diario</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(socio.phone || socio.email) && (
          <div className="flex flex-wrap gap-2">
            {socio.phone && (
              <Button asChild size="sm" variant="outline" className="h-8"><a href={`tel:${socio.phone}`}><Phone className="w-3.5 h-3.5 mr-1" /> Chiama</a></Button>
            )}
            {whatsapp && (
              <Button asChild size="sm" variant="outline" className="h-8"><a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5 mr-1" /> WhatsApp</a></Button>
            )}
            {socio.email && (
              <Button asChild size="sm" variant="outline" className="h-8"><a href={`mailto:${socio.email}`}><Mail className="w-3.5 h-3.5 mr-1" /> Email</a></Button>
            )}
          </div>
        )}

        {puoModificare && (
          <form onSubmit={aggiungiNota} className="space-y-2">
            <Textarea
              rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none" aria-label="Nuova nota nel diario"
              placeholder="Es. chiamato per il rinnovo, ci pensa e ripassa sabato"
              value={nota} onChange={(e) => setNota(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" className="h-8" disabled={!nota.trim() || salvando}>Aggiungi nota</Button>
            </div>
          </form>
        )}

        {errore && <p className="text-sm text-destructive">{errore.message}</p>}
        {!diario && !errore && <p className="text-sm text-muted-foreground">Caricamento…</p>}
        {diario && righe.length === 0 && <p className="text-sm text-muted-foreground">Ancora niente: le note e i contatti compaiono qui.</p>}
        {diario && righe.length > 0 && (
          <ol className="relative border-l border-border ml-1.5 space-y-3">
            {visibili.map((a) => (
              <li key={a.id} className="pl-4">
                <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${a.tipo === "nota" ? "bg-muted-foreground/40" : "bg-primary"}`} aria-hidden="true" />
                {a.tipo !== "nota" && <p className="text-sm">{descriviAttivita(a)}</p>}
                {a.nota && <p className={`text-sm ${a.tipo === "nota" ? "" : "text-muted-foreground"}`}>{a.tipo === "nota" ? a.nota : `«${a.nota}»`}</p>}
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {!a.autore_id && <Bot className="w-3 h-3" aria-hidden="true" />}
                  {formatDataOra(a.created_date)} · {a.autore_nome || "—"}
                </p>
              </li>
            ))}
          </ol>
        )}
        {righe.length > RIGHE_VISIBILI && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setTutto((v) => !v)}>
            {tutto ? "Mostra solo le ultime" : `Mostra tutto (${righe.length})`}
          </Button>
        )}

        {diario && (
          <section aria-labelledby="consensi-titolo" className="pt-3 border-t border-border space-y-2">
            <h3 id="consensi-titolo" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comunicazioni promozionali</h3>
            {TIPI_CONSENSO.map((t) => {
              const c = diario.consensi[t.valore];
              return (
                <label key={t.valore} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={c.valore} disabled={!puoModificare}
                    onCheckedChange={(v) => scegliConsenso(t.valore, v === true)}
                  />
                  <span>{t.etichetta}</span>
                  {c.il && <span className="text-xs text-muted-foreground">· {c.valore ? "dato" : "tolto"} {FONTI[c.fonte] ?? ""} il {formatData(c.il, "breve")}</span>}
                </label>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Il socio li sceglie dal portale. Qui si registrano quelli raccolti su un modulo firmato.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
