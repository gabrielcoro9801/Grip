import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/ui/primitivi/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api } from "@/core/api/client";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";
import EventFormDialog from "@/staff/components/courses/EventFormDialog";
import GiornoDialog from "@/staff/components/courses/GiornoDialog";
import LegendaCorsi from "@/staff/components/courses/LegendaCorsi";
import { grigliaDelMese } from "@/staff/lib/eventUtils";
import { toIsoDate, formatData } from "@/core/domain/format";
import { ErrorState } from "@/ui/StateViews";
import Spinner from "@/ui/Spinner";

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
// Le lezioni che una casella mostra; le altre sono «+N altri», che apre la giornata.
const IN_CASELLA = 3;
const GRIGIO = "#6b7280";
const NESSUNA = [];
const hhmm = (t) => String(t ?? "").slice(0, 5);

/** "2026-11" → { anno, mese } (mese da 0); un valore non valido è il mese di oggi. */
function leggiMese(valore) {
  const m = /^(\d{4})-(\d{2})$/.exec(valore ?? "");
  const oggi = new Date();
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { anno: oggi.getFullYear(), mese: oggi.getMonth() };
  return { anno: Number(m[1]), mese: Number(m[2]) - 1 };
}
const chiaveMese = ({ anno, mese }) => `${anno}-${String(mese + 1).padStart(2, "0")}`;
const spostaMese = ({ anno, mese }, di) => {
  const d = new Date(anno, mese + di, 1);
  return { anno: d.getFullYear(), mese: d.getMonth() };
};

/**
 * Il calendario del mese.
 *
 * Carica solo i 42 giorni della griglia, con i posti già contati dal server
 * (GET /api/calendario/lezioni?dal&al), e tiene in memoria i mesi già visti: tornare a un mese
 * appena guardato non richiede niente. Prima il layout scaricava tutte le lezioni da tre mesi fa
 * e tutte le prenotazioni, e sfogliando più indietro il calendario restava vuoto.
 *
 * Il mese sta nell'indirizzo (`?mese=2026-11`): tornando da una lezione si ritrova quello di prima.
 * La casella del giorno e «+N altri» aprono la giornata a ore (GiornoDialog); una lezione porta
 * alla sua pagina.
 */
export default function CalendarView({ data }) {
  const { courses, categories, instructors, rooms } = data;
  const { staffUser } = useStaffAuth();
  const puoModificare = canEdit(staffUser?.ruolo, "calendar");
  const [parametri, setParametri] = useSearchParams();
  const testoMese = parametri.get("mese");
  const mese = useMemo(() => leggiMese(testoMese), [testoMese]);
  const chiave = chiaveMese(mese);
  const griglia = useMemo(() => grigliaDelMese(mese.anno, mese.mese), [mese]);

  // I mesi già visti: chiave → lezioni. Si svuota dopo una modifica, perché le griglie di due
  // mesi vicini hanno giorni in comune.
  const memoria = useRef(new Map());
  const [lezioni, setLezioni] = useState(null);
  const [errore, setErrore] = useState(null);
  const [versione, setVersione] = useState(0);

  useEffect(() => {
    setErrore(null);
    const giaVisto = memoria.current.get(chiave);
    if (giaVisto) { setLezioni(giaVisto); return undefined; }
    let vivo = true;
    setLezioni(null);
    api.calendario.lezioni({ dal: griglia[0].chiave, al: griglia[griglia.length - 1].chiave })
      .then(({ lezioni: elenco }) => {
        memoria.current.set(chiave, elenco);
        if (vivo) setLezioni(elenco);
      })
      .catch((err) => { if (vivo) setErrore(err); });
    return () => { vivo = false; };
  }, [chiave, griglia, versione]);

  const ricarica = () => { memoria.current.clear(); setVersione((v) => v + 1); };

  const vaiAlMese = (di) => {
    const nuovo = chiaveMese(spostaMese(mese, di));
    setParametri((p) => { const q = new URLSearchParams(p); q.set("mese", nuovo); return q; }, { replace: true });
  };

  // La legenda tiene quello che si è *nascosto*: un corso nuovo compare da solo. Si nasconde per
  // corso; "Tutti/Nessuno" di una categoria agisce sui suoi corsi.
  const [corsiNascosti, setCorsiNascosti] = useState(new Set());
  const [giornoAperto, setGiornoAperto] = useState(null);
  const [nuova, setNuova] = useState(null); // { giorno } della lezione da creare

  const perGiorno = useMemo(() => {
    const map = new Map();
    for (const l of lezioni ?? []) {
      if (l.status !== "active" || corsiNascosti.has(l.course_id)) continue;
      if (!map.has(l.date)) map.set(l.date, []);
      map.get(l.date).push(l);
    }
    for (const elenco of map.values()) elenco.sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
    return map;
  }, [lezioni, corsiNascosti]);

  const monthLabel = `${MONTH_NAMES[mese.mese]} ${mese.anno}`;
  // Oggi nei campi locali, come le chiavi delle caselle (vedi `grigliaDelMese`).
  const todayStr = toIsoDate(new Date());
  const apri = (giorno) => (e) => { e.stopPropagation(); setGiornoAperto(giorno); };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Mese precedente" onClick={() => vaiAlMese(-1)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="font-heading font-semibold text-lg min-w-[160px] text-center capitalize">{monthLabel}</span>
              <Button variant="outline" size="icon" aria-label="Mese successivo" onClick={() => vaiAlMese(1)}><ChevronRight className="w-4 h-4" /></Button>
              {!lezioni && !errore && <Spinner size="sm" label="Caricamento del mese" />}
            </div>
            {puoModificare && (
              <Button size="sm" onClick={() => setNuova({ giorno: null })}><Plus className="w-4 h-4 mr-1" /> Nuova lezione</Button>
            )}
          </div>

          {errore ? (
            <ErrorState error={errore} onRetry={ricarica} />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1">
                {DAY_HEADERS.map(d => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>)}
              </div>

              <div className={`grid grid-cols-7 gap-1 ${lezioni ? "" : "opacity-60"}`}>
                {griglia.map(({ data: date, chiave: dateStr }) => {
                  const isCurrentMonth = date.getMonth() === mese.mese;
                  const isToday = dateStr === todayStr;
                  const delGiorno = perGiorno.get(dateStr) || NESSUNA;
                  const altre = delGiorno.length - IN_CASELLA;
                  return (
                    // Il clic sulla casella apre la giornata; il numero è il pulsante per tastiera e lettori di schermo.
                    <div
                      key={dateStr} onClick={apri(dateStr)}
                      className={`min-w-0 min-h-[70px] sm:min-h-[90px] p-1 rounded-lg border cursor-pointer hover:border-primary/50 transition-colors ${isCurrentMonth ? "bg-card" : "bg-muted/20 opacity-40"} ${isToday ? "border-primary" : "border-border/50"}`}
                    >
                      <button
                        type="button" onClick={apri(dateStr)}
                        aria-label={`Apri ${formatData(dateStr, "estesa")}${delGiorno.length ? `, ${delGiorno.length === 1 ? "1 lezione" : `${delGiorno.length} lezioni`}` : ""}`}
                        className={`text-xs mb-1 rounded px-0.5 hover:underline ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}
                      >
                        {date.getDate()}
                      </button>
                      <div className="space-y-0.5">
                        {delGiorno.slice(0, IN_CASELLA).map(l => {
                          const color = l.colore || GRIGIO;
                          return (
                            // A schermo stretto il nome non si legge e il tocco va alla casella: apre la giornata.
                            <Link
                              key={l.id} to={`/calendario/lezioni/${l.id}`} onClick={(e) => e.stopPropagation()}
                              className="block w-full text-left text-[10px] sm:text-xs px-1.5 py-0.5 rounded truncate hover:opacity-80 transition-opacity max-sm:pointer-events-none"
                              style={{ background: color + "20", color, borderLeft: `3px solid ${color}` }}
                              title={`${l.corso} ${hhmm(l.start_time)}–${hhmm(l.end_time)}`}
                            >
                              {l.corso || "—"}
                            </Link>
                          );
                        })}
                        {altre > 0 && (
                          <button
                            type="button" onClick={apri(dateStr)}
                            className="block text-[10px] sm:text-xs text-muted-foreground px-1 hover:text-foreground hover:underline"
                          >
                            +{altre} {altre === 1 ? "altro" : "altri"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* La legenda dei corsi, che è anche il filtro del calendario. */}
        <div className="lg:w-72 shrink-0 lg:sticky lg:top-4 lg:self-start">
          <LegendaCorsi
            courses={courses} categories={categories} instructors={instructors}
            nascosti={corsiNascosti} onCambia={setCorsiNascosti}
          />
        </div>
      </div>

      <GiornoDialog
        giorno={giornoAperto}
        lezioni={(giornoAperto && perGiorno.get(giornoAperto)) || NESSUNA}
        rooms={rooms}
        onClose={() => setGiornoAperto(null)}
        onNuovaLezione={puoModificare ? (g) => { setGiornoAperto(null); setNuova({ giorno: g }); } : undefined}
      />

      {puoModificare && (
        <EventFormDialog
          modo="lezione"
          open={!!nuova}
          giorno={nuova?.giorno ?? null}
          onClose={() => setNuova(null)}
          data={data}
          onSalvata={ricarica}
        />
      )}
    </div>
  );
}
