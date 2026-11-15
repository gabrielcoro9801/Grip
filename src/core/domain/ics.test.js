// Una lezione nel calendario del telefono: il file .ics e il link di Google Calendar.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileIcs, linkGoogleCalendar } from './ics.js';

const lezione = {
  id: 'abc-123', data: '2026-11-19', inizio: '18:30:00', fine: '19:30:00',
  corso: { nome: 'Pilates, base' }, sala: { nome: 'Sala 2' }, istruttore: { nome: 'Elisa Paccagnella' },
};
const palestra = { nome: 'Grip', indirizzo: 'Via Roma 1; Padova' };

describe('il file .ics', () => {
  const ics = fileIcs(lezione, { palestra, adesso: new Date('2026-11-15T10:00:00Z') });
  const righe = ics.split('\r\n');

  test("è un calendario con un evento, a capo come vuole l'RFC", () => {
    assert.equal(righe[0], 'BEGIN:VCALENDAR');
    assert.ok(righe.includes('BEGIN:VEVENT') && righe.includes('END:VEVENT'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'solo CRLF');
  });

  test("le ore di Roma in UTC: d'inverno un'ora indietro", () => {
    assert.ok(righe.includes('DTSTART:20261119T173000Z'));
    assert.ok(righe.includes('DTEND:20261119T183000Z'));
    assert.ok(righe.includes('UID:abc-123@grip'));
  });

  test('virgole e punti e virgola con la barra; il luogo con sala e palestra', () => {
    assert.ok(righe.includes('SUMMARY:Pilates\\, base'));
    assert.ok(righe.includes('LOCATION:Sala 2\\, Grip\\, Via Roma 1\\; Padova'));
    assert.ok(righe.includes('DESCRIPTION:Con Elisa Paccagnella'));
  });

  test("una riga lunga si piega a 75 caratteri", () => {
    const lunga = fileIcs({ ...lezione, corso: { nome: 'x'.repeat(200) } });
    assert.ok(lunga.split('\r\n').every((r) => r.length <= 75));
    assert.match(lunga, /\r\n x/);
  });
});

describe('il link di Google Calendar', () => {
  test("con titolo, date in UTC e luogo; d'estate due ore indietro", () => {
    const url = new URL(linkGoogleCalendar({ ...lezione, data: '2026-07-02' }, { palestra }));
    assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
    assert.equal(url.searchParams.get('action'), 'TEMPLATE');
    assert.equal(url.searchParams.get('text'), 'Pilates, base');
    assert.equal(url.searchParams.get('dates'), '20260702T163000Z/20260702T173000Z');
    assert.equal(url.searchParams.get('location'), 'Sala 2, Grip, Via Roma 1; Padova');
  });
});
