import { api } from "@/api/client";

/**
 * Prenota una lezione.
 *
 * Le regole — c'è posto? è già prenotato? che posizione in lista? — **non stanno più qui**.
 * Stavano solo qui, ed era il problema: il browser contava i posti e mandava al server una
 * riga con lo stato già deciso, che veniva scritta senza controlli. Bastava una richiesta
 * fatta a mano per confermarsi su una lezione piena, e due soci che prenotavano l'ultimo
 * posto nello stesso istante si confermavano entrambi in buona fede.
 *
 * Ora decide il server, dentro una transazione. Questa funzione resta come punto unico da
 * cui passano tutte le schermate, e traduce la risposta nella forma che già si aspettano.
 */
export async function createBooking(session, memberId) {
  try {
    const { booking } = await api.prenotazioni.crea({ sessionId: session.id, memberId });
    return {
      ok: true,
      booking,
      status: booking.status,
      waitlist_position: booking.waitlist_position,
    };
  } catch (errore) {
    // 409 è "hai già prenotato": è una risposta prevista, non un guasto, e il testo che
    // arriva dal server è già quello da mostrare.
    return { ok: false, error: errore.message };
  }
}

/**
 * Disdice una prenotazione, promuove chi è in lista d'attesa e rinumera la coda.
 *
 * Erano quattro chiamate separate dal browser, e la seconda ne chiamava una che non esiste
 * (`Booking.bulkUpdate`): il primo in lista risultava già promosso, poi partiva un errore,
 * e la coda restava sfalsata per sempre senza che nessuno potesse rimetterla a posto. Ora
 * è una transazione sola sul server: o succede tutto, o non succede niente.
 */
export async function cancelBooking(bookingId) {
  const { promoted } = await api.prenotazioni.disdici(bookingId);
  return { promoted };
}

/**
 * Prenota tutte le sessioni attive e future per un membro.
 * - Salta sessioni già prenotate dal membro (controllo di sicurezza)
 * - Salta sessioni con data passata
 * - Per le altre: crea confirmed o waitlisted secondo la logica standard
 * - Ritorna riepilogo { confirmed, waitlisted }
 */
export async function bookAllSessions(sessions, memberId, allBookings) {
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

    const result = await createBooking(session, memberId);
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