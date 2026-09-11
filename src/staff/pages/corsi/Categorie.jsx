import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import CategoriesTab from "@/staff/components/courses/CategoriesTab";

export default function Categorie() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Categorie"
        description="Come si raggruppano i corsi: servono a ritrovarli e a dargli un colore in calendario."
      />
      <CategoriesTab data={data} reload={reload} />
    </>
  );
}
