import React, { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api/client";
import { useMemberAuth } from "@/lib/MemberAuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CoursesByCategory from "@/components/member/CoursesByCategory";
import CoursesByCalendar from "@/components/member/CoursesByCalendar";
import { createBooking, cancelBooking, bookAllSessions, cancelAllBookings } from "@/lib/bookingUtils";
import { useToast } from "@/components/ui/use-toast";

export default function MemberCoursesCalendar() {
  const { memberUser } = useMemberAuth();
  const { toast } = useToast();
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [c, cat, inst, ev, sess, r, b] = await Promise.all([
        api.entities.Course.list(),
        api.entities.Category.list(),
        api.entities.Instructor.list(),
        api.entities.Event.list("-created_date", 200),
        api.entities.Session.list("-date", 500),
        api.entities.Room.list(),
        api.entities.Booking.list("-created_date", 500),
      ]);
      setCourses(c); setCategories(cat); setInstructors(inst);
      setEvents(ev); setSessions(sess); setRooms(r);
      setBookings(b.filter(bk => bk.status !== "cancelled"));
    } catch (err) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const unsub = api.entities.Booking.subscribe(() => loadData());
    return unsub;
  }, [loadData]);

  const enrichedSessions = useMemo(() => {
    return sessions.map(s => {
      const event = events.find(e => e.id === s.event_id);
      const course = courses.find(c => c.id === event?.course_id);
      const category = categories.find(cat => cat.id === course?.category_id);
      const instructor = instructors.find(i => i.id === course?.instructor_id);
      const room = rooms.find(r => r.id === s.room_id);
      return { ...s, _course: course, _category: category, _instructor: instructor, _room: room };
    });
  }, [sessions, events, courses, categories, instructors, rooms]);

  const handleBook = async (session) => {
    setActionLoading(true);
    try {
      const result = await createBooking(session, memberUser.member_id, memberUser.nome, bookings);
      if (!result.ok) {
        toast({ title: "Prenotazione non riuscita", description: result.error, variant: "destructive" });
      } else if (result.status === "confirmed") {
        toast({ title: "Prenotazione confermata", description: session._course?.name });
      } else {
        toast({ title: "Aggiunto alla lista d'attesa", description: `${session._course?.name} — posizione #${result.waitlist_position}` });
      }
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleCancel = async (bookingId) => {
    setActionLoading(true);
    try {
      await cancelBooking(bookingId);
      toast({ title: "Prenotazione annullata" });
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleBookAll = async (sessionsToBook) => {
    setActionLoading(true);
    let result = null;
    try {
      result = await bookAllSessions(sessionsToBook, memberUser.member_id, memberUser.nome, bookings);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
    return result;
  };

  const handleCancelAll = async (bookingsToCancel) => {
    setActionLoading(true);
    let result = null;
    try {
      result = await cancelAllBookings(bookingsToCancel);
      loadData();
    } catch (err) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    }
    setActionLoading(false);
    return result;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-heading font-bold">Corsi</h1>
        <p className="text-sm text-muted-foreground">Prenota i tuoi corsi</p>
      </div>
      <Tabs defaultValue="categorie">
        <TabsList className="w-full">
          <TabsTrigger value="categorie" className="flex-1">Categorie</TabsTrigger>
          <TabsTrigger value="calendario" className="flex-1">Calendario</TabsTrigger>
        </TabsList>
        <TabsContent value="categorie">
          <CoursesByCategory
            enrichedSessions={enrichedSessions}
            bookings={bookings}
            memberUser={memberUser}
            onBook={handleBook}
            onCancel={handleCancel}
            onBookAll={handleBookAll}
            onCancelAll={handleCancelAll}
            actionLoading={actionLoading}
          />
        </TabsContent>
        <TabsContent value="calendario">
          <CoursesByCalendar
            enrichedSessions={enrichedSessions}
            bookings={bookings}
            memberUser={memberUser}
            onBook={handleBook}
            onCancel={handleCancel}
            actionLoading={actionLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}