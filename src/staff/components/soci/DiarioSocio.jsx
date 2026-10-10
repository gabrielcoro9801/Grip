import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Textarea } from "@/ui/primitivi/textarea";
import { useToast } from "@/ui/primitivi/use-toast";
import { formatDataOra } from "@/core/domain/format";
import { descriviAttivita, NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { etichettaSegnale } from "@/core/domain/segnali";
import { BookOpen, Bot } from "lucide-react";

// Quante righe si vedono prima di "mostra tutto": le ultime sono quelle che servono prima di
// richiamare.
const RIGHE_VISIBILI = 6;
// Le righe che scrive il sistema da solo: non hanno una nota da citare, ma un testo da leggere.
const AUTOMATICHE = new Set(["segnale_aperto", "segnale_chiuso", "archiviazione_automatica"]);

/** La riga in parole; un "Fatto" dice anche per che cosa: "Fatto: chiamato · Abbonamento in scadenza". */
function titolo(a) {
  const base = descriviAttivita(a);
  const segnali = a.tipo === "contatto" ? a.riferimento?.segnali ?? [] : [];
  return segnali.length ? `${base} · ${segnali.map(etichettaSegnale).join(", ")}` : base;
}

/**
 * Il diario del socio nella sua scheda: le note della segreteria e, in sola lettura, la sua
 * storia — da quando era un contatto, l'iscrizione, i "Fatto" di Da fare, e le cose da fare
 * comparse e risolte (le scrive il giro, giro.js). Il lavoro si fa in Da fare: qui si racconta.
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

  const righe = diario ? [...diario.attivita].reverse() : [];
  const visibili = tutto ? righe : righe.slice(0, RIGHE_VISIBILI);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-heading flex items-center gap-2"><BookOpen className="w-4 h-4" /> Diario</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
                {a.tipo !== "nota" && <p className="text-sm">{titolo(a)}</p>}
                {a.nota && <p className={`text-sm ${a.tipo === "nota" ? "" : "text-muted-foreground"}`}>{a.tipo === "nota" || AUTOMATICHE.has(a.tipo) ? a.nota : `«${a.nota}»`}</p>}
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

      </CardContent>
    </Card>
  );
}
