import React, { useState, useEffect, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { CalendarDays, Repeat, LayoutList, DoorOpen, UserCog, Tags } from "lucide-react";
import { api } from "@/core/api/client";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";
import { LoadingState } from "@/ui/Spinner";
import { ErrorState } from "@/ui/StateViews";

// Le sei cose che la sezione contiene, nell'ordine in cui si usano: prima si prepara chi e
// dove (categorie, istruttori, sale), poi si descrive il corso, poi lo si mette in
// calendario, e infine si guardano le sessioni che si ripetono. Erano su due piani — tre
// "pillole" in alto e altre quattro dentro "Anagrafiche" — con uno stile che non era quello del
// resto del gestionale e senza un indirizzo proprio: una sala non si poteva mandare a un collega.
//
// "Catalogo corsi" e non "Corsi": la sezione si chiama già Gestione corsi, e una voce che
// ripete il nome della sezione non dice dove porta. Stessa regola di "Elenco soci".
//
// Calendario resta attiva anche sulla pagina di una lezione: ci si arriva dal calendario.
const tabsBase = [
  { label: "Calendario", path: "/calendario", icon: CalendarDays, match: (p) => p === "/calendario" || p.startsWith("/calendario/lezioni/") },
  { label: "Sessioni", path: "/calendario/sessioni", icon: Repeat },
  { label: "Catalogo corsi", path: "/calendario/corsi", icon: LayoutList },
  { label: "Sale", path: "/calendario/sale", icon: DoorOpen },
  { label: "Istruttori", path: "/calendario/istruttori", icon: UserCog },
  { label: "Categorie", path: "/calendario/categorie", icon: Tags },
];

export default function CorsiLayout() {
  const [data, setData] = useState({ courses: [], categories: [], instructors: [], rooms: [] });
  const [loading, setLoading] = useState(true);

  // Qui stanno solo i quattro elenchi che tutte le viste citano — un corso cita una categoria,
  // un istruttore, e una lezione una sala — e che sono pochi. Lezioni, prenotazioni, sessioni e
  // soci li chiede ogni vista, solo per quello che mostra: il mese del calendario, una lezione,
  // una pagina di soci (M8). Prima qui si scaricavano otto elenchi interi a ogni apertura, con
  // tutte le prenotazioni da tre mesi fa.
  //
  // `reload` resta la stessa funzione per tutte, così una modifica fatta in una vista si vede
  // anche nelle altre. Un errore di caricamento si mostra con "Riprova"; un errore di un
  // ricaricamento dopo una modifica lascia i dati di prima al loro posto, e lo dice.
  const [errore, setErrore] = useState(null);
  const [caricato, setCaricato] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const [courses, categories, instructors, rooms] = await Promise.all([
        api.entities.Course.list(),
        api.entities.Category.list(),
        api.entities.Instructor.list(),
        api.entities.Room.list(),
      ]);
      setData({ courses, categories, instructors, rooms });
      setCaricato(true);
      setErrore(null);
    } catch (err) {
      setErrore(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabsBase} label="Sezioni dei corsi" />
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
