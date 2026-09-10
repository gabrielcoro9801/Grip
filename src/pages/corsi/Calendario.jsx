import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import CalendarView from "@/components/courses/CalendarView";

export default function Calendario() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Quando i corsi si tengono davvero: una lezione è un corso messo a un'ora, in una sala, con un istruttore."
      />
      <CalendarView data={data} reload={reload} />
    </>
  );
}
