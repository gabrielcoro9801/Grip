import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/core/api/client";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Button } from "@/ui/primitivi/button";
import { Label } from "@/ui/primitivi/label";
import { Textarea } from "@/ui/primitivi/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { useToast } from "@/ui/primitivi/use-toast";
import PageHeader from "@/staff/components/PageHeader";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { formatData, formatDataOra } from "@/core/domain/format";
import { NOTA_DIARIO_MASSIMO } from "@/core/domain/lead";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";
import { GraduationCap, NotebookPen } from "lucide-react";

// Le prossime lezioni, o le ultime: è lì che si vede chi è venuto e chi no.
const VISTE = [
  { valore: "prossime", etichetta: "Prossime", intervallo: (oggi) => ({ dal: oggi, al: spostaGiorni(oggi, 6) }) },
  { valore: "passate", etichetta: "Ultimi 7 giorni", intervallo: (oggi) => ({ dal: spostaGiorni(oggi, -7), al: oggi }) },
];

const ESITI = {
  presente: { etichetta: "Presente", tono: "positivo" },
  no_show: { etichetta: "Non è venuto", tono: "negativo" },
  in_attesa: { etichetta: "Prenotato", tono: "info" },
};

/** Le note degli istruttori su un socio, e una nuova. Finiscono nel suo diario: le legge anche la reception. */
function NoteSocio({ socio, puoScrivere, onChiudi }) {
  const { toast } = useToast();
  const [note, setNote] = useState(null);
  const [testo, setTesto] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!socio) return;
    setNote(null);
    setTesto("");
    api.istruttore.socio(socio.socio_id).then((r) => setNote(r.note)).catch(() => setNote([]));
  }, [socio]);

  const salva = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const { nota } = await api.istruttore.nota(socio.socio_id, testo);
      setNote((n) => [nota, ...(n ?? [])]);
      setTesto("");
      toast({ title: socio.nome, description: "Nota salvata nel diario." });
    } catch (err) {
      toast({ title: "Nota non salvata", description: err.message, variant: "destructive" });
    }
    setSalvando(false);
  };

  return (
    <Dialog open={Boolean(socio)} onOpenChange={(v) => { if (!v && !salvando) onChiudi(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{socio?.nome}</DialogTitle>
          <DialogDescription>Le note degli istruttori. Restano nel suo diario, e le legge anche la reception.</DialogDescription>
        </DialogHeader>
        {puoScrivere && (
          <form onSubmit={salva} className="space-y-2">
            <Label htmlFor="nota-istruttore">Nuova nota</Label>
            <Textarea id="nota-istruttore" rows={2} maxLength={NOTA_DIARIO_MASSIMO} className="resize-none"
              placeholder="Es. si è fatto male al ginocchio: niente salti per ora" value={testo} onChange={(e) => setTesto(e.target.value)} />
            <Button type="submit" size="sm" disabled={!testo.trim() || salvando}>{salvando ? "Salvataggio..." : "Salva la nota"}</Button>
          </form>
        )}
        {note === null ? <LoadingState minHeight="h-16" /> : note.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna nota, per ora.</p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {note.map((n) => (
              <li key={n.id} className="text-sm rounded-lg bg-muted/50 p-2">
                <p>{n.nota}</p>
                <p className="text-xs text-muted-foreground mt-1">{n.autore_nome} · {formatDataOra(n.created_date)}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Le mie lezioni: la vista dell'istruttore. Le sue lezioni di oggi e dei prossimi giorni, chi è
 * prenotato, chi è venuto e chi no (dagli ingressi: niente appello), chi salta spesso, e una nota
 * nel diario del socio. Vede solo i soci delle sue lezioni. Pensata per il telefono.
 */
export default function LeMieLezioni() {
  const { staffUser } = useStaffAuth();
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState(null);
  const [aperto, setAperto] = useState(null);
  const [vista, setVista] = useState(VISTE[0]);
  const puoScrivere = canEdit(staffUser?.ruolo, "lezioni_istruttore");

  const carica = useCallback(() => {
    setErrore(null);
    api.istruttore.lezioni(vista.intervallo(oggiIso())).then(setDati).catch(setErrore);
  }, [vista]);
  useEffect(() => { carica(); }, [carica]);

  if (errore) return <ErrorState error={errore} onRetry={carica} />;
  if (!dati) return <LoadingState minHeight="h-64" />;
  if (!dati.collegato) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <PageHeader title="Le mie lezioni" />
        <EmptyState icon={GraduationCap} title="Account non collegato" description="Il tuo account non è collegato a un istruttore: chiedi all'amministratore di collegarlo in Utenti e ruoli." />
      </div>
    );
  }

  const oggi = oggiIso();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Le mie lezioni" description={`${dati.istruttore.nome} · dal ${formatData(dati.dal, "breve")} al ${formatData(dati.al, "breve")}`} />

      <div className="flex gap-2" role="tablist" aria-label="Quali lezioni">
        {VISTE.map((v) => (
          <button
            key={v.valore} type="button" role="tab" aria-selected={vista.valore === v.valore} onClick={() => setVista(v)}
            className={`px-4 py-1.5 rounded-full text-sm border ${vista.valore === v.valore ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
          >
            {v.etichetta}
          </button>
        ))}
      </div>

      {dati.spesso.length > 0 && (
        <section aria-labelledby="salta-spesso">
          <h2 id="salta-spesso" className="text-sm font-heading font-semibold mb-2">Saltano spesso (ultime 4 settimane)</h2>
          <ul className="flex flex-wrap gap-2">
            {dati.spesso.map((s) => (
              <li key={s.socio_id}>
                <button type="button" onClick={() => setAperto(s)} className="text-sm rounded-full border px-3 py-1 hover:bg-muted/50">
                  {s.nome} · {s.no_show} no-show
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dati.lezioni.length === 0 ? (
        <EmptyState icon={GraduationCap} title="Nessuna lezione" description={vista.valore === "prossime" ? "Non hai lezioni in calendario nei prossimi giorni." : "Nessuna lezione negli ultimi sette giorni."} />
      ) : (
        <ol className="space-y-3">
          {(vista.valore === "passate" ? [...dati.lezioni].reverse() : dati.lezioni).map((l) => {
            const venuti = l.prenotati.filter((p) => p.esito === "presente").length;
            const attesi = l.prenotati.filter((p) => p.stato === "confirmed").length;
            return (
              <li key={l.id}>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium">{l.corso}</p>
                        <p className="text-sm text-muted-foreground">
                          {l.data === oggi ? "Oggi" : formatData(l.data, "giornoBreve")} · {l.inizio}–{l.fine}{l.sala ? ` · ${l.sala}` : ""}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums text-muted-foreground">
                        {l.data <= oggi ? `${venuti} su ${attesi} presenti` : `${attesi} su ${l.capienza} prenotati`}
                      </p>
                    </div>
                    {l.prenotati.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nessun prenotato.</p>
                    ) : (
                      <ul className="divide-y">
                        {l.prenotati.map((p) => {
                          const e = p.stato === "waitlisted" ? { etichetta: "In lista d'attesa", tono: "neutro" } : ESITI[p.esito] ?? ESITI.in_attesa;
                          return (
                            <li key={p.socio_id} className="flex items-center justify-between gap-2 py-2">
                              <span className="text-sm min-w-0 break-words">
                                {p.nome}
                                {p.salta_spesso && <span className="ml-2 text-xs text-destructive">salta spesso</span>}
                              </span>
                              <span className="flex items-center gap-1 shrink-0">
                                <StatusBadge status={p.esito ?? p.stato} label={e.etichetta} tone={e.tono} />
                                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Note su ${p.nome}`} onClick={() => setAperto(p)}>
                                  <NotebookPen className="w-4 h-4" />
                                </Button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      <NoteSocio socio={aperto} puoScrivere={puoScrivere} onChiudi={() => setAperto(null)} />
    </div>
  );
}
