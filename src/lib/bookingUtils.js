import { base44 } from "@/api/base44Client";

/**
 * Crea una prenotazione su una Sessione.
 * - Blocca doppie prenotazioni dello stesso membro (stato diverso da cancelled)
 * - Se c'è posto → confirmed
 * - Se piena → waitlisted con posizione = lunghezza attuale waitlist + 1
 */
export async function createBooking(session, memberId, memberName, allBookings) {
  const existing = allBookings.find(
    b => b.session_id === session.id && b.member_id === memberId && b.status !== "cancelled"
  );
  if (existing) {
    return { ok: false, error: "Hai già una prenotazione per questa sessione." };
  }

  const confirmed = allBookings.filter(b => b.session_id === session.id && b.status === "confirmed");
  const capacity = session.capacity || 0;
  const isFull = confirmed.length >= capacity;

  if (isFull) {
    const waitlisted = allBookings.filter(b => b.session_id === session.id && b.status === "waitlisted");
    const position = waitlisted.length + 1;
    const booking = await base44.entities.Booking.create({
      session_id: session.id,
      member_id: memberId,
      member_name: memberName,
      status: "waitlisted",
      waitlist_position: position,
    });
    return { ok: true, booking, status: "waitlisted", waitlist_position: position };
  }

  const booking = await base44.entities.Booking.create({
    session_id: session.id,
    member_id: memberId,
    member_name: memberName,
    status: "confirmed",
  });
  return { ok: true, booking, status: "confirmed" };
}

/**
 * Cancella una prenotazione.
 * - Recupera lo stato ORIGINALE prima di cancellare
 * - Se era confirmed: promuove il primo in lista d'attesa, poi rinumera
 * - Se era waitlisted: NON promuove (non si libera posto), solo rinumera
 */
export async function cancelBooking(bookingId) {
  const booking = await base44.entities.Booking.get(bookingId);
  const originalStatus = booking.status;
  let promoted = false;

  await base44.entities.Booking.update(bookingId, { status: "cancelled" });

  if (originalStatus === "confirmed") {
    const waitlist = await base44.entities.Booking.filter({
      session_id: booking.session_id,
      status: "waitlisted",
    });
    if (waitlist.length > 0) {
      waitlist.sort((a, b) => (a.waitlist_position || 999) - (b.waitlist_position || 999));
      const promotedBooking = waitlist[0];
      await base44.entities.Booking.update(promotedBooking.id, {
        status: "confirmed",
        waitlist_position: null,
      });
      promoted = true;
      const remaining = waitlist.slice(1);
      if (remaining.length > 0) {
        await base44.entities.Booking.bulkUpdate(
          remaining.map((b, i) => ({ id: b.id, waitlist_position: i + 1 }))
        );
      }
    }
  } else if (originalStatus === "waitlisted") {
    const waitlist = await base44.entities.Booking.filter({
      session_id: booking.session_id,
      status: "waitlisted",
    });
    waitlist.sort((a, b) => (a.waitlist_position || 999) - (b.waitlist_position || 999));
    if (waitlist.length > 0) {
      await base44.entities.Booking.bulkUpdate(
        waitlist.map((b, i) => ({ id: b.id, waitlist_position: i + 1 }))
      );
    }
  }
  return { promoted };
}

/**
 * Prenota tutte le sessioni attive e future per un membro.
 * - Salta sessioni già prenotate dal membro (controllo di sicurezza)
 * - Salta sessioni con data passata
 * - Per le altre: crea confirmed o waitlisted secondo la logica standard
 * - Ritorna riepilogo { confirmed, waitlisted }
 */
export async function bookAllSessions(sessions, memberId, memberName, allBookings) {
  const today = new Date().toISOString().split("T")[0];
  const eligible = sessions
    .filter(s => s.status === "active" && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  let confirmed = 0;
  let waitlisted = 0;

  for (const session of eligible) {
    const existing = allBookings.find(
      b => b.session_id === session.id && b.member_id === memberId && b.status !== "cancelled"
    );
    if (existing) continue;

    const result = await createBooking(session, memberId, memberName, allBookings);
    if (result.ok) {
      if (result.status === "confirmed") confirmed++;
      else waitlisted++;
    }
  }

  return { confirmed, waitlisted };
}

/**
 * Cancella tutte le prenotazioni attive di un membro (booking per booking).
 * - Applica la logica di cancellazione singola a ciascuna prenotazione
 * - Ogni sessione ha la propria lista d'attesa indipendente
 * - Ritorna riepilogo { cancelled, promotions }
 */
export async function cancelAllBookings(bookingsToCancel) {
  let cancelled = 0;
  let promotions = 0;

  for (const booking of bookingsToCancel) {
    const result = await cancelBooking(booking.id);
    cancelled++;
    if (result.promoted) promotions++;
  }

  return { cancelled, promotions };
}

/** Disponibilità di una sessione: posti confermati, residui, lista d'attesa */
export function getSessionAvailability(session, allBookings) {
  const confirmed = allBookings.filter(b => b.session_id === session.id && b.status === "confirmed");
  const waitlisted = allBookings.filter(b => b.session_id === session.id && b.status === "waitlisted");
  const capacity = session.capacity || 0;
  const available = capacity - confirmed.length;
  return { available, isFull: available <= 0, capacity, confirmed: confirmed.length, waitlisted: waitlisted.length };
}

/** Ritorna la prenotazione attiva (non cancelled) di un membro per una sessione */
export function getMemberBooking(sessionId, memberId, allBookings) {
  return allBookings.find(
    b => b.session_id === sessionId && b.member_id === memberId && b.status !== "cancelled"
  ) || null;
}