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
        description="Chi si è iscritto a quale lezione, e chi si è poi presentato."
      />
      <BookingsTab data={data} reload={reload} />
    </>
  );
}
