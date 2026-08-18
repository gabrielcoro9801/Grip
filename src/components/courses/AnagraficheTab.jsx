import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CoursesTab from "@/components/courses/CoursesTab";
import RoomsTab from "@/components/courses/RoomsTab";
import InstructorsTab from "@/components/courses/InstructorsTab";
import CategoriesTab from "@/components/courses/CategoriesTab";

export default function AnagraficheTab({ data, reload }) {
  return (
    <Tabs defaultValue="corsi">
      <TabsList>
        <TabsTrigger value="corsi">Corsi</TabsTrigger>
        <TabsTrigger value="sale">Sale</TabsTrigger>
        <TabsTrigger value="istruttori">Istruttori</TabsTrigger>
        <TabsTrigger value="categorie">Categorie</TabsTrigger>
      </TabsList>
      <TabsContent value="corsi" className="mt-4"><CoursesTab data={data} reload={reload} /></TabsContent>
      <TabsContent value="sale" className="mt-4"><RoomsTab data={data} reload={reload} /></TabsContent>
      <TabsContent value="istruttori" className="mt-4"><InstructorsTab data={data} reload={reload} /></TabsContent>
      <TabsContent value="categorie" className="mt-4"><CategoriesTab data={data} reload={reload} /></TabsContent>
    </Tabs>
  );
}