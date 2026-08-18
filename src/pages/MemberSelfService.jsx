import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dumbbell, CreditCard, Calendar, User, Clock, MapPin, Users, ChevronLeft, ChevronRight, CheckCircle, XCircle } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import moment from "moment";
import {
  DAYS, DAYS_IT, getWeekDates, getSeatInfo,
  createBookingWithChecks, cancelBookingAndPromote,
} from "@/lib/courseValidation";

export default function MemberSelfService() {
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [subscriptions, setSubscriptions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState("all");
  const [bookingStatus, setBookingStatus] = useState({}); // { [courseId-date]: "loading" | "ok" | "waitlist" | "error" }

  const loadData = useCallback(() => {
    Promise.all([
      base44.entities.Member.list(),
      base44.entities.Course.list(),
      base44.entities.Room.list(),
      base44.entities.Booking.list(),
    ]).then(([m, c, r, b]) => {
      setMembers(m); setCourses(c); setRooms(r); setBookings(b);
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!selectedMemberId) return;
    base44.entities.Subscription.filter({ member_id: selectedMemberId }).then(setSubscriptions);
  }, [selectedMemberId]);

  const member = members.find(m => m.id === selectedMemberId);
  const roomById = (id) => rooms.find(r => r.id === id);

  // Prenotazioni del cliente
  const myBookings = bookings.filter(b => b.member_id === selectedMemberId);
  const myUpcoming = myBookings
    .filter(b => b.status !== "cancelled" && moment(b.date).isSameOrAfter(moment(), "day"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const myPast = myBookings
    .filter(b => b.status === "cancelled" || moment(b.date).isBefore(moment(), "day"))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Calendario corso: genera date della settimana corrente
  const weekDates = getWeekDates(weekOffset);

  // Filtra corsi per giorno selezionato
  const visibleCourses = selectedDay === "all"
    ? courses
    : courses.filter(c => c.day_of_week === selectedDay);

  const handleBook = async (course, date) => {
    const key = `${course.id}-${date}`;
    setBookingStatus(s => ({ ...s, [key]: "loading" }));

    const room = roomById(course.room_id);
    const result = await createBookingWithChecks(member, course, room, date, bookings);

    if (!result.ok) {
      setBookingStatus(s => ({ ...s, [key]: "error" }));
      setTimeout(() => setBookingStatus(s => { const n = {...s}; delete n[key]; return n; }), 3000);
      return;
    }

    setBookingStatus(s => ({ ...s, [key]: result.waitlisted ? "waitlist" : "ok" }));
    loadData();
    setTimeout(() => setBookingStatus(s => { const n = {...s}; delete n[key]; return n; }), 3000);
  };

  const handleCancel = async (booking) => {
    const course = courses.find(c => c.id === booking.course_id);
    const room = course ? roomById(course.room_id) : null;
    await cancelBookingAndPromote(booking, room, bookings);
    loadData();
  };

  const hasBookingFor = (courseId, date) => {
    return myBookings.some(b => b.course_id === courseId && b.date === date && b.status !== "cancelled");
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  // === SCHERMATA LOGIN (mock) ===
  if (!member) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Dumbbell className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-heading font-bold">Portale Corsi</h1>
            <p className="text-sm text-muted-foreground mt-1">Accedi per prenotare i tuoi corsi</p>
          </div>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-muted-foreground" />
                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Seleziona il tuo nome (demo)" /></SelectTrigger>
                  <SelectContent>{members.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Login semplificato per demo — seleziona un cliente esistente
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // === PORTALE CLIENTE ===
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold">Portale Corsi</h1>
              <p className="text-sm text-muted-foreground">Ciao, {member.full_name}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSelectedMemberId("")}>
            Esci
          </Button>
        </div>

        {/* Abbonamento */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> Il mio abbonamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">Nessun abbonamento attivo</p>
            ) : (
              <div className="space-y-2">
                {subscriptions.map(sub => (
                  <div key={sub.id} className="p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-sm">{sub.plan_name}</h3>
                      <StatusBadge status={sub.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <div>Inizio: {moment(sub.start_date).format("D MMM YYYY")}</div>
                      <div>Fine: {moment(sub.end_date).format("D MMM YYYY")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="calendar">
          <TabsList className="w-full">
            <TabsTrigger value="calendar" className="flex-1">Calendario corsi</TabsTrigger>
            <TabsTrigger value="mine" className="flex-1">Le mie prenotazioni ({myUpcoming.length})</TabsTrigger>
          </TabsList>

          {/* === CALENDARIO === */}
          <TabsContent value="calendar" className="mt-4 space-y-4">
            {/* Filtro giorno */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Button
                size="sm"
                variant={selectedDay === "all" ? "default" : "outline"}
                onClick={() => setSelectedDay("all")}
                className="whitespace-nowrap"
              >
                Tutti
              </Button>
              {DAYS.map(d => {
                const hasCourses = courses.some(c => c.day_of_week === d);
                if (!hasCourses) return null;
                return (
                  <Button
                    key={d}
                    size="sm"
                    variant={selectedDay === d ? "default" : "outline"}
                    onClick={() => setSelectedDay(d)}
                    className="whitespace-nowrap"
                  >
                    {DAYS_IT[d]}
                  </Button>
                );
              })}
            </div>

            {/* Navigazione settimana */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(weekOffset - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">
                {weekOffset === 0 ? "Questa settimana" : weekOffset === 1 ? "Settimana prossima" : `Tra ${weekOffset} settimane`}
              </span>
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(weekOffset + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Lista corsi per giorno */}
            {visibleCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nessun corso programmato</p>
            ) : (
              <div className="space-y-4">
                {visibleCourses.map(course => {
                  const date = weekDates.find(w => w.day === course.day_of_week)?.date;
                  if (!date) return null;
                  const room = roomById(course.room_id);
                  const info = getSeatInfo(course, room, bookings);
                  const status = bookingStatus[`${course.id}-${date}`];
                  const alreadyBooked = hasBookingFor(course.id, date);
                  const isPast = moment(date).isBefore(moment(), "day");

                  return (
                    <Card key={course.id} className="border-0 shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-medium">{course.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {moment(date).format("dddd D MMM")} · {DAYS_IT[course.day_of_week]}
                            </p>
                          </div>
                          {info.isFull ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200">Completo</Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-200">
                              {info.residual} residui
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {course.start_time}—{course.end_time}</div>
                          <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {course.room_name}</div>
                          <div className="flex items-center gap-1"><User className="w-3 h-3" /> {course.instructor_name}</div>
                          <div className="flex items-center gap-1"><Users className="w-3 h-3" /> {info.confirmed}/{info.capacity} occupati</div>
                        </div>

                        <div className="mt-3">
                          {alreadyBooked ? (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-primary font-medium">
                              <CheckCircle className="w-4 h-4" /> Sei già prenotato
                            </div>
                          ) : isPast ? (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                              <XCircle className="w-4 h-4" /> Corso già trascorso
                            </div>
                          ) : status === "loading" ? (
                            <Button disabled className="w-full" size="sm">
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Prenotazione...
                            </Button>
                          ) : status === "ok" ? (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-emerald-600 font-medium">
                              <CheckCircle className="w-4 h-4" /> Prenotazione confermata!
                            </div>
                          ) : status === "waitlist" ? (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-amber-600 font-medium">
                              <CheckCircle className="w-4 h-4" /> In lista d'attesa
                            </div>
                          ) : status === "error" ? (
                            <div className="flex items-center justify-center gap-2 py-2 text-sm text-red-500 font-medium">
                              <XCircle className="w-4 h-4" /> Prenotazione fallita
                            </div>
                          ) : (
                            <Button
                              className="w-full"
                              size="sm"
                              variant={info.isFull ? "outline" : "default"}
                              onClick={() => handleBook(course, date)}
                            >
                              {info.isFull ? "Entra in lista d'attesa" : "Prenota posto"}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* === LE MIE PRENOTAZIONI === */}
          <TabsContent value="mine" className="mt-4 space-y-4">
            {/* Future */}
            <div>
              <h3 className="text-sm font-heading font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Prossime</h3>
              {myUpcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna prenotazione futura</p>
              ) : (
                <div className="space-y-2">
                  {myUpcoming.map(b => {
                    const course = courses.find(c => c.id === b.course_id);
                    return (
                      <Card key={b.id} className="border-0 shadow-sm">
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm">{b.course_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {moment(b.date).format("dddd D MMM")}
                                {course && ` · ${course.start_time}—${course.end_time}`}
                              </p>
                              {course && (
                                <p className="text-xs text-muted-foreground">{course.room_name} · {course.instructor_name}</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              {b.status === "waitlisted" && b.waitlist_position ? (
                                <Badge className="bg-amber-100 text-amber-700 border-amber-200">Attesa #{b.waitlist_position}</Badge>
                              ) : (
                                <StatusBadge status={b.status} />
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive h-7 text-xs"
                                onClick={() => handleCancel(b)}
                              >
                                Disdici
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Passate */}
            {myPast.length > 0 && (
              <div>
                <h3 className="text-sm font-heading font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Passate</h3>
                <div className="space-y-2">
                  {myPast.map(b => (
                    <Card key={b.id} className="border-0 shadow-sm opacity-60">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{b.course_name}</p>
                            <p className="text-xs text-muted-foreground">{moment(b.date).format("dddd D MMM YYYY")}</p>
                          </div>
                          <StatusBadge status={b.status} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}