import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { CalendarDays, ClipboardCheck, LayoutList, DoorOpen, UserCog, Tags } from "lucide-react";
import { api } from "@/core/api/client";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";
import { LoadingState } from "@/ui/Spinner";

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
  const loadData = useCallback(async () => {
    const [courses, categories, instructors, events, sessions, rooms, members, bookings] = await Promise.all([
      api.entities.Course.list(),
      api.entities.Category.list(),
      api.entities.Instructor.list(),
      api.entities.Event.list("-created_date", 200),
      api.entities.Session.list("-date", 500),
      api.entities.Room.list(),
      api.entities.Member.list(),
      api.entities.Booking.list("-created_date", 500),
    ]);
    setData({ courses, categories, instructors, events, sessions, rooms, members, bookings });
    setLoading(false);
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
          {loading ? <LoadingState minHeight="h-full" /> : <Outlet context={{ data, reload: loadData }} />}
        </PageContainer>
      </div>
    </div>
  );
}
