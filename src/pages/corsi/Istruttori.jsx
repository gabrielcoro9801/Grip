import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import InstructorsTab from "@/components/courses/InstructorsTab";

export default function Istruttori() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Istruttori"
        description="Chi tiene le lezioni. Si assegnano a un corso in calendario."
      />
      <InstructorsTab data={data} reload={reload} />
    </>
  );
}
