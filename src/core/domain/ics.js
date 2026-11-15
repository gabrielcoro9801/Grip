// Una lezione nel calendario del telefono: il file .ics (RFC 5545) e, per Android, il link di
// Google Calendar (Chrome su Android non apre un .ics: lo scarica e basta).
//
// Gli orari escono in UTC (…Z): un fuso con il nome (TZID) vorrebbe anche la sua definizione
// dentro il file, e qualche calendario la ignora. L'ora di Roma diventa l'istante giusto con
// `istanteRoma`, ora legale compresa.
import { istanteRoma } from './giorni.js';

const hhmm = (t) => String(t ?? '').slice(0, 5);
/** 2026-11-19T17:30:00.000Z → 20261119T173000Z */
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Le virgole, i punti e virgola, le barre e gli a capo si scrivono con la barra davanti. */
const testo = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Una riga lunga si spezza a 75 caratteri, e la continuazione comincia con uno spazio. */
function piega(riga) {
  const pezzi = [];
  for (let i = 0; i < riga.length; i += i === 0 ? 75 : 74) pezzi.push(riga.slice(i, i + (i === 0 ? 75 : 74)));
  return pezzi.join('\r\n ');
}

function dettagli(lezione, palestra) {
  const inizio = istanteRoma(lezione.data, hhmm(lezione.inizio));
  const fine = istanteRoma(lezione.data, hhmm(lezione.fine || lezione.inizio));
  const titolo = lezione.corso?.nome ?? 'Lezione';
  const dove = [lezione.sala?.nome, palestra?.nome, palestra?.indirizzo].filter(Boolean).join(', ');
  const descrizione = lezione.istruttore?.nome ? `Con ${lezione.istruttore.nome}` : '';
  return { inizio, fine, titolo, dove, descrizione };
}

/**
 * Il file .ics di una lezione del portale ({ id, data, inizio, fine, corso, sala, istruttore }).
 * @param palestra { nome, indirizzo } per il luogo, se c'è
 */
export function fileIcs(lezione, { palestra = null, adesso = new Date() } = {}) {
  const { inizio, fine, titolo, dove, descrizione } = dettagli(lezione, palestra);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Grip//Portale soci//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${lezione.id}@grip`,
    `DTSTAMP:${utc(adesso)}`,
    `DTSTART:${utc(inizio)}`,
    `DTEND:${utc(fine)}`,
    `SUMMARY:${testo(titolo)}`,
    ...(dove ? [`LOCATION:${testo(dove)}`] : []),
    ...(descrizione ? [`DESCRIPTION:${testo(descrizione)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(piega).join('\r\n') + '\r\n';
}

/** Il link che apre Google Calendar con la lezione già scritta. */
export function linkGoogleCalendar(lezione, { palestra = null } = {}) {
  const { inizio, fine, titolo, dove, descrizione } = dettagli(lezione, palestra);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: titolo, dates: `${utc(inizio)}/${utc(fine)}` });
  if (dove) q.set('location', dove);
  if (descrizione) q.set('details', descrizione);
  return `https://calendar.google.com/calendar/render?${q}`;
}
