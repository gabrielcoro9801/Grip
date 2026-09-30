import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { CalendarDays, ClipboardCheck, LayoutList, DoorOpen, UserCog, Tags } from "lucide-react";
import { api } from "@/core/api/client";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";
import { oggiIso, spostaGiorni } from "@/core/domain/giorni";

// Quanto calendario passato si carica: abbastanza per rivedere il trimestre appena chiuso.
const GIORNI_DI_STORIA = 92;

// Le sei cose che la sezione contiene, nell'ordine in cui si usano: prima si prepara chi e
// dove (categorie, istruttori, sale), poi si descrive il corso, poi lo si mette in
// calendario, e infine si guarda chi si è prenotato. Erano su due piani — tre "pillole" in
// alto e altre quattro dentro "Anagrafiche" — con uno stile che non era quello del resto del
// gestionale e senza un indirizzo proprio: una sala non si poteva mandare a un collega.
//
// "Catalogo corsi" e non "Corsi": la sezione si chiama già Gestione corsi, e una voce che
// ripete il nome della sezione non dice dove porta. Stessa regola di "Elenco soci".
const tabsBase = [
  { label: "Calendario", path: "/calendario", icon: CalendarDays, end: true },
  { label: "Prenotazioni", path: "/calendario/prenotazioni", icon: ClipboardCheck },
  { label: "Catalogo corsi", path: "/calendario/corsi", icon: LayoutList },
  { label: "Sale", path: "/calendario/sale", icon: DoorOpen },
  { label: "Istruttori", path: "/calendario/istruttori", icon: UserCog },
  { label: "Categorie", path: "/calendario/categorie", icon: Tags },
];

export default function CorsiLayout() {
  const [data, setData] = useState({
    courses: [], categories: [], instructors: [], events: [], sessions: [],
    rooms: [], members: [], bookings: [],
  });
  const [loading, setLoading] = useState(true);

  // Il caricamento sta qui e non nelle singole pagine: le sei viste lavorano tutte sugli
  // stessi elenchi (un evento cita un corso, che cita una sala e un istruttore), e
  // ricaricarli a ogni cambio di voce farebbe lampeggiare la pagina per riottenere quello
  // che si aveva già. `reload` resta la stessa funzione per tutte, così una modifica fatta
  // in una vista si vede anche nelle altre.
  //
  // Le lezioni si caricano da tre mesi fa in avanti, tutte. Prima erano "le 500 con la data
  // più alta": bastavano pochi corsi settimanali generati per un anno perché il mese corrente
  // uscisse dalla lista, e il calendario restava vuoto proprio dove serviva. Le prenotazioni
  // sono quelle di quelle stesse lezioni, e gli eventi tutti: sono pochi, e un evento vecchio
  // può avere lezioni ancora da tenere. Sfogliando il calendario più indietro di tre mesi le
  // lezioni non ci sono: caricare per mese è il passo successivo (ARC-01 dell'audit).
  //
  // Un errore di caricamento si mostra con "Riprova": senza, la pagina restava sulla rotellina
  // per sempre. Un errore di un ricaricamento dopo una modifica, invece, lascia i dati di prima
  // al loro posto — sono ancora buoni — e lo dice.
  const [errore, setErrore] = useState(null);
  const [caricato, setCaricato] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const dal = spostaGiorni(oggiIso(), -GIORNI_DI_STORIA);
      const [courses, categories, instructors, events, sessions, rooms, members, bookings] = await Promise.all([
        api.entities.Course.list(),
        api.entities.Category.list(),
        api.entities.Instructor.list(),
        api.entities.Event.list("-created_date"),
        api.entities.Session.filter({ date__gte: dal }, "date"),
        api.entities.Room.list(),
        api.entities.Member.list(),
        api.prenotazioni.dal(dal),
      ]);
      setData({ courses, categories, instructors, events, sessions, rooms, members, bookings });
      setCaricato(true);
      setErrore(null);
    } catch (err) {
      setErrore(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Il numero delle prenotazioni sta nella barra perché è l'unica voce che vale la pena
  // guardare senza aprirla: dice se c'è qualcosa da fare.
  const tabs = useMemo(
    () => tabsBase.map((tab) => (
      tab.path === "/calendario/prenotazioni"
        ? { ...tab, label: `Prenotazioni (${data.bookings.length})` }
        : tab
    )),
    [data.bookings.length]
  );

  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Sezioni dei corsi" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          {loading ? (
            <LoadingState minHeight="h-full" />
          ) : errore && !caricato ? (
            <ErrorState error={errore} onRetry={() => { setLoading(true); loadData(); }} />
          ) : (
            <>
              {errore && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  Aggiornamento non riuscito: i dati mostrati potrebbero non essere gli ultimi. ({errore.message})
                </p>
              )}
              <Outlet context={{ data, reload: loadData }} />
            </>
          )}
        </PageContainer>
      </div>
    </div>
  );
}
