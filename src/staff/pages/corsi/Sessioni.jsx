import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import SessioniTab from "@/staff/components/courses/SessioniTab";

// Sessioni ha preso il posto di Prenotazioni (e /calendario/prenotazioni rimanda qui): le
// prenotazioni di una lezione stanno nella pagina della lezione, qui ci sono le sessioni di ogni
// corso e le loro prenotazioni fisse.
export default function Sessioni() {
  const { data } = useOutletContext();

  return (
    <>
      <PageHeader title="Sessioni" />
      <SessioniTab data={data} />
    </>
  );
}
