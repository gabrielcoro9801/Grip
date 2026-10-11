import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import CoursesTab from "@/staff/components/courses/CoursesTab";

export default function CatalogoCorsi() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Catalogo corsi"
        description="Cos'è un corso: il nome, la categoria, chi lo tiene, fino a quando si disdice. Orari, sala e posti stanno nel calendario."
      />
      <CoursesTab data={data} reload={reload} />
    </>
  );
}
