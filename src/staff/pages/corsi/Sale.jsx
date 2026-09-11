import React from "react";
import { useOutletContext } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import RoomsTab from "@/staff/components/courses/RoomsTab";

export default function Sale() {
  const { data, reload } = useOutletContext();

  return (
    <>
      <PageHeader
        title="Sale"
        description="Gli spazi in cui si tengono le lezioni, con quanta gente ci sta."
      />
      <RoomsTab data={data} reload={reload} />
    </>
  );
}
