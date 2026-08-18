import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import CalendarView from "@/components/courses/CalendarView";
import BookingsTab from "@/components/courses/BookingsTab";
import AnagraficheTab from "@/components/courses/AnagraficheTab";

export default function CalendarPage() {
  const [data, setData] = useState({
    courses: [], categories: [], instructors: [], events: [], sessions: [],
    rooms: [], members: [], bookings: [],
  });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [courses, categories, instructors, events, sessions, rooms, members, bookings] = await Promise.all([
      base44.entities.Course.list(),
      base44.entities.Category.list(),
      base44.entities.Instructor.list(),
      base44.entities.Event.list("-created_date", 200),
      base44.entities.Session.list("-date", 500),
      base44.entities.Room.list(),
      base44.entities.Member.list(),
      base44.entities.Booking.list("-created_date", 500),
    ]);
    setData({ courses, categories, instructors, events, sessions, rooms, members, bookings });
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

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