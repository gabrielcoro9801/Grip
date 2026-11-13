import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Pencil, Plus, Repeat, Search, Trash2 } from "lucide-react";
import { api } from "@/core/api/client";
import { Button } from "@/ui/primitivi/button";
import { Card, CardContent } from "@/ui/primitivi/card";
import { Input } from "@/ui/primitivi/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitivi/select";
import StatusBadge from "@/ui/StatusBadge";
import { LoadingState } from "@/ui/Spinner";
import { EmptyState, ErrorState } from "@/ui/StateViews";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import { DAYS, DAYS_IT } from "@/staff/lib/courseValidation";
import { nomeGiorno, hhmm } from "@/staff/lib/modificaEvento";
import { formatData } from "@/core/domain/format";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import EliminaEventoDialog from "@/staff/components/courses/EliminaEventoDialog";
import FisseSessioneDialog from "@/staff/components/courses/FisseSessioneDialog";
import { cn } from "@/ui/utils";

const GRIGIO = "#6b7280";
const TUTTE = "tutte";
const ordineGiorno = (g) => (DAYS.includes(g) ? DAYS.indexOf(g) : 9);
const perGiornoEOra = (a, b) => ordineGiorno(a.giorno) - ordineGiorno(b.giorno) || hhmm(a.start_time).localeCompare(hhmm(b.start_time));

/** "dal 05/10/2026 al 21/12/2026": dalla prima all'ultima lezione in calendario. */
const periodo = (s) => {
  const dal = s.prima_lezione ?? s.start_date;
  const al = s.ultima_lezione;
  return al ? `dal ${formatData(dal, "breve")} al ${formatData(al, "breve")}` : `dal ${formatData(dal, "breve")}`;
};

/**
 * Le sessioni, corso per corso: una card per corso, con le sue sessioni in corso. Una sessione è
 * una lezione che si ripete ogni settimana, stesso giorno e stessa ora (una riga di `events`).
 *
 * Dalla riga: «Prenotazioni fisse · n» apre le fisse della sessione; matita e cestino agiscono
 * sulla sessione intera, da oggi in poi. Le prenotazioni delle singole lezioni stanno nella
 * pagina della lezione, dal calendario.
 *
 * I dati li dà il server (GET /api/calendario/sessioni): quelle in corso, con il numero delle
 * finite. Le finite si chiedono solo aprendo «Finite», e sono in sola lettura.
 *
 * Solo i corsi attivi; uno disattivato compare se ha ancora sessioni in corso. Le vecchie
 * sessioni «a date scelte» si vedono, ma non si cambiano più da qui.
 */
export default function SessioniTab({ data }) {
  const { courses, categories } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");

  const [inCorso, setInCorso] = useState(null); // { sessioni, finite } | { errore }
  const [finite, setFinite] = useState(null); // null = chiuse; [] | { errore } | "caricamento"
  const [cerca, setCerca] = useState("");
  const [categoria, setCategoria] = useState(TUTTE);
  const [nuovaPer, setNuovaPer] = useState(null); // il corso
  const [inModifica, setInModifica] = useState(null);
  const [daEliminare, setDaEliminare] = useState(null);
  const [fisseDi, setFisseDi] = useState(null);

  const caricaFinite = useCallback(() => {
    setFinite("caricamento");
    api.calendario.sessioni({ stato: "finite" })
      .then((r) => setFinite(r.sessioni))
      .catch((err) => setFinite({ errore: err.message }));
  }, []);

  const carica = useCallback(() => api.calendario.sessioni()
    .then(setInCorso)
    .catch((err) => setInCorso((prima) => (prima?.sessioni ? prima : { errore: err }))), []);

  useEffect(() => { carica(); }, [carica]);

  // Dopo una modifica: le sessioni in corso, e le finite se sono aperte (una sessione accorciata
  // o eliminata passa di là).
  const ricarica = () => { carica(); if (finite !== null) caricaFinite(); };

  const q = cerca.trim().toLowerCase();
  const passa = useCallback(
    (nome, idCategoria) => (!q || String(nome).toLowerCase().includes(q)) && (categoria === TUTTE || idCategoria === categoria),
    [q, categoria],
  );

  const card = useMemo(() => {
    if (!inCorso?.sessioni) return [];
    const perCorso = new Map();
    for (const s of inCorso.sessioni) perCorso.set(s.course_id, [...(perCorso.get(s.course_id) ?? []), s]);
    return courses
      .filter((c) => c.attivo !== false || perCorso.has(c.id))
      .filter((c) => passa(c.name, c.category_id))
      .sort((a, b) => a.name.localeCompare(b.name, "it"))
      .map((c) => ({ corso: c, sessioni: (perCorso.get(c.id) ?? []).sort(perGiornoEOra) }));
  }, [inCorso, courses, passa]);

  const finiteFiltrate = Array.isArray(finite) ? finite.filter((s) => passa(s.corso, s.category_id)) : [];

  if (inCorso?.errore) return <ErrorState error={inCorso.errore} onRetry={carica} />;
  if (!inCorso) return <LoadingState minHeight="h-64" label="Caricamento delle sessioni" />;

  const colore = (idCategoria) => categories.find((c) => c.id === idCategoria)?.color || GRIGIO;
  const apriFinite = () => (finite === null ? caricaFinite() : setFinite(null));

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search" placeholder="Cerca il corso…" aria-label="Cerca il corso" className="pl-9"
            value={cerca} onChange={(e) => setCerca(e.target.value)}
          />
        </div>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="sm:w-56" aria-label="Categoria"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TUTTE}>Tutte le categorie</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {card.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={q || categoria !== TUTTE ? "Nessun corso corrisponde" : "Nessun corso attivo"}
          description={q || categoria !== TUTTE ? "Cambia la ricerca o la categoria." : "I corsi si creano dal Catalogo corsi."}
        />
      ) : (
        <div className="space-y-4">
          {card.map(({ corso, sessioni }) => (
            <Card key={corso.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: colore(corso.category_id) }} aria-hidden="true" />
                  <h2 className="font-heading font-semibold text-base flex-1 min-w-0 truncate">{corso.name}</h2>
                  {corso.attivo === false && <StatusBadge status="disattivato" tone="neutro" label="Disattivato" />}
                  {puoModificare && corso.attivo !== false && (
                    <Button size="sm" variant="outline" onClick={() => setNuovaPer(corso)}>
                      <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Nuova sessione
                    </Button>
                  )}
                </div>
                {sessioni.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessuna sessione in corso.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {sessioni.map((s) => (
                      <RigaSessione
                        key={s.id} sessione={s} puoModificare={puoModificare}
                        onFisse={() => setFisseDi(s)} onModifica={() => setInModifica(s)} onElimina={() => setDaEliminare(s)}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {inCorso.finite > 0 && (
        <section className="mt-6" aria-labelledby="titolo-finite">
          <button
            type="button" id="titolo-finite" aria-expanded={finite !== null} onClick={apriFinite}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", finite === null && "-rotate-90")} aria-hidden="true" />
            Finite ({inCorso.finite})
          </button>
          {finite === "caricamento" ? (
            <LoadingState minHeight="h-24" label="Caricamento delle sessioni finite" />
          ) : finite?.errore ? (
            <p role="alert" className="text-sm text-destructive mt-2">Sessioni finite non caricate: {finite.errore}</p>
          ) : finite !== null && (
            <Card className="border-0 shadow-sm mt-2">
              <CardContent className="px-4 py-1">
                {finiteFiltrate.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3">Nessuna sessione finita corrisponde.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {finiteFiltrate.map((s) => <RigaSessione key={s.id} sessione={s} conCorso />)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {puoModificare && (
        <>
          <EventFormDialog
            modo="sessione" data={data}
            open={!!nuovaPer || !!inModifica} corso={nuovaPer} sessione={inModifica}
            onClose={() => { setNuovaPer(null); setInModifica(null); }} onSalvata={ricarica}
          />
          <EliminaEventoDialog
            bersaglio={daEliminare ? {
              ambito: "serie", evento_id: daEliminare.id, titolo: "Eliminare la sessione?",
              descrizione: `${daEliminare.corso} · ogni ${nomeGiorno(daEliminare.giorno)} ${hhmm(daEliminare.start_time)}–${hhmm(daEliminare.end_time)}`,
            } : null}
            onClose={() => setDaEliminare(null)} onEliminato={ricarica}
          />
        </>
      )}
      <FisseSessioneDialog sessione={fisseDi} puoModificare={puoModificare} onClose={() => setFisseDi(null)} onCambiato={carica} />
    </>
  );
}

/**
 * Una sessione in una riga: giorno, orario, sala, posti, periodo. Le finite (`onFisse` assente)
 * sono in sola lettura.
 */
function RigaSessione({ sessione: s, puoModificare = false, conCorso = false, onFisse, onModifica, onElimina }) {
  const settimanale = s.recurrence_type === "weekly";
  const descrizione = `${s.corso}, ${settimanale ? DAYS_IT[s.giorno]?.toLowerCase() : "date scelte"} ${hhmm(s.start_time)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm font-medium">
          {conCorso && <span>{s.corso} · </span>}
          {settimanale ? DAYS_IT[s.giorno] ?? s.giorno : "Date scelte"}
          <span className="tabular-nums"> · {hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {s.sala ?? "Sala —"} · {s.capacity} posti · <span className="tabular-nums">{periodo(s)}</span>
        </p>
      </div>
      {onFisse && (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-8" onClick={onFisse}>
            Prenotazioni fisse · <span className="tabular-nums ml-1">{s.fisse}</span>
          </Button>
          {puoModificare && settimanale && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifica la sessione ${descrizione}`} onClick={onModifica}>
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </Button>
              <span className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />
              <Button
                variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={`Elimina la sessione ${descrizione}`} onClick={onElimina}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
