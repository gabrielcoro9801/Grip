import React, { useState, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import CourseSessionsList from "@/member/components/CourseSessionsList";
import { formatData } from "@/core/domain/format";

export default function CoursesByCategory({ enrichedSessions, bookings, memberUser, onBook, onCancel, onBookAll, onCancelAll, actionLoading }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState(null);

  const today = new Date().toISOString().split("T")[0];

  const upcomingSessions = useMemo(() => {
    return enrichedSessions
      .filter(s => s.status === "active" && s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
  }, [enrichedSessions, today]);

  const categoryList = useMemo(() => {
    const map = new Map();
    upcomingSessions.forEach(s => {
      const cat = s._category;
      if (!cat) return;
      if (!map.has(cat.id)) map.set(cat.id, { ...cat, sessionCount: 0, courseIds: new Set() });
      const entry = map.get(cat.id);
      entry.sessionCount++;
      if (s._course) entry.courseIds.add(s._course.id);
    });
    return Array.from(map.values()).map(c => ({ id: c.id, name: c.name, color: c.color, sessionCount: c.sessionCount, courseCount: c.courseIds.size }));
  }, [upcomingSessions]);

  const categoryCourses = useMemo(() => {
    if (!selectedCategory) return [];
    const map = new Map();
    upcomingSessions.forEach(s => {
      if (s._category?.id === selectedCategory && s._course) {
        if (!map.has(s._course.id)) map.set(s._course.id, { ...s._course, sessionCount: 0, nextSession: s });
        map.get(s._course.id).sessionCount++;
      }
    });
    return Array.from(map.values());
  }, [upcomingSessions, selectedCategory]);

  const courseSessions = useMemo(() => {
    if (!selectedCourse) return [];
    return upcomingSessions.filter(s => s._course?.id === selectedCourse);
  }, [upcomingSessions, selectedCourse]);

  // Livello 1: lista categorie
  if (!selectedCategory) {
    return (
      <div className="flex flex-col gap-3 mt-4">
        {categoryList.map(cat => (
          <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
            className="p-4 rounded-xl bg-card border border-border hover:border-primary hover:shadow-md transition-all text-left w-full">
            <div className="flex items-center gap-2">
              {cat.color && <div className="w-3 h-3 rounded" style={{ background: cat.color }} />}
              <p className="font-heading font-semibold">{cat.name}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{cat.courseCount} corsi · {cat.sessionCount} sessioni</p>
          </button>
        ))}
        {categoryList.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun corso disponibile</p>}
      </div>
    );
  }

  // Livello 2: lista corsi della categoria
  if (!selectedCourse) {
    return (
      <div className="space-y-4 mt-4">
        <button onClick={() => setSelectedCategory(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Tutte le categorie
        </button>
        <h2 className="font-heading font-semibold text-lg">{categoryList.find(c => c.id === selectedCategory)?.name}</h2>
        <div className="flex flex-col gap-3">
          {categoryCourses.map(course => (
            <button key={course.id} onClick={() => setSelectedCourse(course.id)}
              className="p-4 rounded-xl bg-card border border-border hover:border-primary hover:shadow-md transition-all text-left w-full">
              <p className="font-heading font-semibold">{course.name}</p>
              {course.nextSession ? (
                <p className="text-xs text-muted-foreground mt-1">Prossima sessione: {formatData(course.nextSession.date, "giornoBreve")}, {course.nextSession.start_time}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">{course.sessionCount} sessioni disponibili</p>
              )}
            </button>
          ))}
          {categoryCourses.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun corso in questa categoria</p>}
        </div>
      </div>
    );
  }

  // Livello 3: sessioni del corso con azioni di massa
  const course = categoryCourses.find(c => c.id === selectedCourse);
  return (
    <CourseSessionsList
      course={course}
      categoryName={categoryList.find(c => c.id === selectedCategory)?.name}
      sessions={courseSessions}
      bookings={bookings}
      memberUser={memberUser}
      onBook={onBook}
      onCancel={onCancel}
      onBookAll={onBookAll}
      onCancelAll={onCancelAll}
      actionLoading={actionLoading}
      onBack={() => setSelectedCourse(null)}
    />
  );
}