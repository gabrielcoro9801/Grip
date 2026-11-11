import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import CalendarView from "@/staff/components/courses/CalendarView";

export default function Calendario() {
  const { data } = useOutletContext();

  return (
    <>
      <PageHeader title="Calendario" />
      <CalendarView data={data} />
    </>
  );
}
