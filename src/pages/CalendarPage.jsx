import React, { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import CalendarView from "@/components/courses/CalendarView";
import BookingsTab from "@/components/courses/BookingsTab";
import AnagraficheTab from "@/components/courses/AnagraficheTab";
import { LoadingState } from "@/components/shared/Spinner";

export default function CalendarPage() {
  const [data, setData] = useState({
    courses: [], categories: [], instructors: [], events: [], sessions: [],
    rooms: [], members: [], bookings: [],
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [courses, categories, instructors, events, sessions, rooms, members, bookings] = await Promise.all([
      api.entities.Course.list(),
      api.entities.Category.list(),
      api.entities.Instructor.list(),
      api.entities.Event.list("-created_date", 200),
      api.entities.Session.list("-date", 500),
      api.entities.Room.list(),
      api.entities.Member.list(),
      api.entities.Booking.list("-created_date", 500),
    ]);
    setData({ courses, categories, instructors, events, sessions, rooms, members, bookings });
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <LoadingState minHeight="h-full" />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Gestione corsi" description="Calendario, prenotazioni e anagrafiche" />
      <Tabs defaultValue="calendario">
        <TabsList>
          <TabsTrigger value="calendario">Calendario</TabsTrigger>
          <TabsTrigger value="prenotazioni">Prenotazioni ({data.bookings.length})</TabsTrigger>
          <TabsTrigger value="anagrafiche">Anagrafiche</TabsTrigger>
        </TabsList>
        <TabsContent value="calendario" className="mt-4"><CalendarView data={data} reload={loadData} /></TabsContent>
        <TabsContent value="prenotazioni" className="mt-4"><BookingsTab data={data} reload={loadData} /></TabsContent>
        <TabsContent value="anagrafiche" className="mt-4"><AnagraficheTab data={data} reload={loadData} /></TabsContent>
      </Tabs>
    </div>
  );
}