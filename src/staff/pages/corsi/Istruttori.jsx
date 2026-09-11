import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import InstructorsTab from "@/staff/components/courses/InstructorsTab";

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
