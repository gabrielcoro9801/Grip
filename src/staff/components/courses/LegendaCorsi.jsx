import React, { useMemo } from "react";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Eye, EyeOff } from "lucide-react";

const GRIGIO = "#6b7280";
const perNome = (a, b) => a.localeCompare(b, "it", { sensitivity: "base" });

/**
 * La legenda del calendario, che è anche il suo filtro: i corsi raggruppati per categoria, nei
 * colori con cui compaiono nella griglia.
 *
 * Una riga è un corso, e si clicca tutta: tinta del colore della categoria quando le sue lezioni
 * si vedono, barrata e grigia quando sono nascoste. "Tutti" e "Nessuno" fanno lo stesso con
 * tutti i corsi di una categoria. L'istruttore si legge al passaggio del mouse.
 *
 * Si tiene quello che è *nascosto* (lo decide CalendarView): un corso nuovo compare da solo.
 *
 * @param nascosti  Set degli id dei corsi nascosti
 * @param onCambia  riceve il nuovo Set
 */
export default function LegendaCorsi({ courses, categories, instructors, nascosti, onCambia }) {
  const gruppi = useMemo(() => {
    const perCategoria = new Map();
    for (const c of courses) {
      const chiave = categories.some((cat) => cat.id === c.category_id) ? c.category_id : null;
      if (!perCategoria.has(chiave)) perCategoria.set(chiave, []);
      perCategoria.get(chiave).push(c);
    }
    const elenco = [...categories]
      .sort((a, b) => perNome(a.name, b.name))
      .filter((cat) => perCategoria.has(cat.id))
      .map((cat) => ({ id: cat.id, nome: cat.name, colore: cat.color || GRIGIO, corsi: perCategoria.get(cat.id) }));
    // I corsi senza categoria in fondo, in grigio: ci sono anche loro nella griglia.
    if (perCategoria.has(null)) elenco.push({ id: "senza", nome: "Senza categoria", colore: GRIGIO, corsi: perCategoria.get(null) });
    for (const g of elenco) g.corsi.sort((a, b) => perNome(a.name, b.name));
    return elenco;
  }, [courses, categories]);

  const nomeIstruttore = (id) => instructors.find((i) => i.id === id)?.full_name;

  const alterna = (id) => {
    const next = new Set(nascosti);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCambia(next);
  };
  const mostra = (corsi, visibili) => {
    const next = new Set(nascosti);
    for (const c of corsi) { if (visibili) next.delete(c.id); else next.add(c.id); }
    onCambia(next);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-5">
        {gruppi.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nessun corso</p>}
        {gruppi.map((g) => {
          const tuttiVisibili = g.corsi.every((c) => !nascosti.has(c.id));
          const nessunoVisibile = g.corsi.every((c) => nascosti.has(c.id));
          return (
            <section key={g.id} aria-labelledby={`legenda-${g.id}`} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.colore }} aria-hidden="true" />
                <h4 id={`legenda-${g.id}`} className="text-sm font-semibold flex-1 truncate">{g.nome}</h4>
                <button
                  type="button" onClick={() => mostra(g.corsi, true)} disabled={tuttiVisibili}
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default"
                  aria-label={`Mostra tutti i corsi di ${g.nome}`}
                >
                  Tutti
                </button>
                <button
                  type="button" onClick={() => mostra(g.corsi, false)} disabled={nessunoVisibile}
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default"
                  aria-label={`Nascondi tutti i corsi di ${g.nome}`}
                >
                  Nessuno
                </button>
              </div>
              <ul className="space-y-1.5">
                {g.corsi.map((c) => {
                  const visibile = !nascosti.has(c.id);
                  const istruttore = nomeIstruttore(c.instructor_id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button" onClick={() => alterna(c.id)} aria-pressed={visibile}
                        title={istruttore ? `Istruttore: ${istruttore}` : undefined}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                          visibile ? "hover:opacity-80" : "border border-border bg-card text-muted-foreground hover:bg-muted/40"
                        }`}
                        style={visibile ? { background: `${g.colore}20`, color: g.colore, borderLeft: `3px solid ${g.colore}` } : undefined}
                      >
                        <span className={`flex-1 truncate ${visibile ? "font-medium" : "line-through"}`}>{c.name}</span>
                        {visibile
                          ? <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
                          : <EyeOff className="w-4 h-4 shrink-0" aria-hidden="true" />}
                        <span className="sr-only">{visibile ? "(visibile nel calendario)" : "(nascosto)"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
