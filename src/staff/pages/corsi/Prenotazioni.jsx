import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import BookingsTab from "@/staff/components/courses/BookingsTab";

export default function Prenotazioni() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Prenotazioni"
        description="Chi è iscritto a quale lezione. Da qui si prenota per un socio, si conferma, si gestisce la lista d'attesa e si disdice."
      />
      <BookingsTab data={data} reload={reload} />
    </>
  );
}
