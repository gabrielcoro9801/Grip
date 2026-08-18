import { timeOverlap } from "./courseValidation";

const DAY_MAP = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0 };

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

/**
 * Calcola tutte le date delle sessioni generate da un Event.
 * - single: una sola data (start_date)
 * - weekly: una o più giorni della settimana, all'interno del range
 *   - by_date: da start_date a end_date
 *   - by_count: N sessioni totali (sommando tutti i giorni selezionati)
 * - custom: le date esplicite in custom_dates
 */
export function generateSessionDates(event) {
  if (event.recurrence_type === "single") {
    return [event.start_date];
  }

  if (event.recurrence_type === "custom") {
    return [...(event.custom_dates || [])].sort();
  }

  // weekly
  const daysOfWeek = event.days_of_week || [];
  if (daysOfWeek.length === 0) return [];

  const targetDays = new Set(daysOfWeek.map(d => DAY_MAP[d]).filter(d => d !== undefined));
  if (targetDays.size === 0) return [];

  const dates = [];
  let current = new Date(event.start_date + "T00:00:00");
  const MAX_ITERATIONS = 10000;
  let iterations = 0;

  if (event.end_condition === "by_date") {
    const end = new Date(event.end_date + "T00:00:00");
    while (current <= end && iterations < MAX_ITERATIONS) {
      if (targetDays.has(current.getDay())) {
        dates.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
      iterations++;
    }
  } else if (event.end_condition === "by_count") {
    const count = Number(event.occurrence_count) || 0;
    while (dates.length < count && iterations < MAX_ITERATIONS) {
      if (targetDays.has(current.getDay())) {
        dates.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
      iterations++;
    }
  }

  return dates;
}

/**
 * Controlla conflitti di sala e istruttore per ogni data.
 * Ritorna { conflicts: [{date, type, message}], cleanDates: [...] }.
 * Le date in cleanDates non hanno conflitti e possono essere generate.
 */
export function checkEventConflicts(dates, newEvent, course, existingSessions, existingEvents, existingCourses) {
  const conflicts = [];
  const cleanDates = [];

  for (const date of dates) {
    let conflictFound = null;
    for (const session of existingSessions) {
      if (session.status === "cancelled") continue;
      if (session.date !== date) continue;
      if (!timeOverlap(newEvent.start_time, newEvent.end_time, session.start_time, session.end_time)) continue;

      if (session.room_id === newEvent.room_id) {
        const conflictEvent = existingEvents.find(e => e.id === session.event_id);
        const conflictCourse = existingCourses.find(c => c.id === conflictEvent?.course_id);
        conflictFound = {
          date,
          type: "sala",
          message: `${formatDate(date)}: conflitto sala con "${conflictCourse?.name || "N/D"}" ${session.start_time}–${session.end_time}`,
        };
        break;
      }

      const sessionEvent = existingEvents.find(e => e.id === session.event_id);
      const sessionCourse = existingCourses.find(c => c.id === sessionEvent?.course_id);
      if (sessionCourse && course && sessionCourse.instructor_id === course.instructor_id) {
        conflictFound = {
          date,
          type: "istruttore",
          message: `${formatDate(date)}: conflitto istruttore con "${sessionCourse.name}" ${session.start_time}–${session.end_time}`,
        };
        break;
      }
    }

    if (conflictFound) {
      conflicts.push(conflictFound);
    } else {
      cleanDates.push(date);
    }
  }

  return { conflicts, cleanDates };
}

/**
 * Controlla se una singola sessione (con nuovi valori) confligge con altre sessioni esistenti.
 * Esclude la sessione stessa dalla verifica. Usato per la modifica di sessioni esistenti.
 * Ritorna { conflict: false } o { conflict: true, type, message }.
 */
export function checkSessionConflict(session, newValues, course, allSessions, allEvents, allCourses) {
  const date = session.date;
  const startTime = newValues.start_time || session.start_time;
  const endTime = newValues.end_time || session.end_time;
  const roomId = newValues.room_id || session.room_id;

  for (const otherSession of allSessions) {
    if (otherSession.id === session.id) continue;
    if (otherSession.status === "cancelled") continue;
    if (otherSession.date !== date) continue;
    if (!timeOverlap(startTime, endTime, otherSession.start_time, otherSession.end_time)) continue;

    if (otherSession.room_id === roomId) {
      const conflictEvent = allEvents.find(e => e.id === otherSession.event_id);
      const conflictCourse = allCourses.find(c => c.id === conflictEvent?.course_id);
      return {
        conflict: true,
        type: "sala",
        message: `${formatDate(date)}: conflitto sala con "${conflictCourse?.name || "N/D"}" ${otherSession.start_time}–${otherSession.end_time}`,
      };
    }

    const otherEvent = allEvents.find(e => e.id === otherSession.event_id);
    const otherCourse = allCourses.find(c => c.id === otherEvent?.course_id);
    if (otherCourse && course && otherCourse.instructor_id === course.instructor_id) {
      return {
        conflict: true,
        type: "istruttore",
        message: `${formatDate(date)}: conflitto istruttore con "${otherCourse.name}" ${otherSession.start_time}–${otherSession.end_time}`,
      };
    }
  }

  return { conflict: false };
}