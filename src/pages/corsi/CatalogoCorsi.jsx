import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import CoursesTab from "@/components/courses/CoursesTab";

export default function CatalogoCorsi() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Catalogo corsi"
        description="Cos'è un corso: il nome, la durata, quante persone entrano. Non quando si tiene — quello è il calendario."
      />
      <CoursesTab data={data} reload={reload} />
    </>
  );
}
