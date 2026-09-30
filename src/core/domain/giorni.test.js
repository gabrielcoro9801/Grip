import test from "node:test";
import assert from "node:assert/strict";
import { oggiIso, spostaGiorni, giorniFra, eUnGiorno } from "./giorni.js";

test("spostarsi di N giorni attraversa mesi e anni", () => {
  assert.equal(spostaGiorni("2026-01-31", 1), "2026-02-01");
  assert.equal(spostaGiorni("2026-03-01", -1), "2026-02-28");
  assert.equal(spostaGiorni("2026-01-01", 365), "2027-01-01");
  assert.equal(spostaGiorni("non una data", 1), null);
});

test("i giorni fra due date, senza perderne uno col cambio dell'ora", () => {
  assert.equal(giorniFra("2026-02-01", "2026-02-10"), 9);
  assert.equal(giorniFra("2026-02-10", "2026-02-01"), -9);
  // L'ultima domenica di marzo e di ottobre la settimana ha un'ora in più o in meno.
  assert.equal(giorniFra("2026-03-25", "2026-04-01"), 7);
  assert.equal(giorniFra("2026-10-25", "2026-11-01"), 7);
  // Un istante conta per il suo giorno.
  assert.equal(giorniFra("2026-02-01", "2026-02-02T23:59:00Z"), 1);
  assert.equal(giorniFra(null, "2026-02-01"), null);
});

test("oggi è quello di Roma, non quello di Greenwich", () => {
  // L'una di notte del 1° ottobre a Roma è ancora il 30 settembre in UTC.
  assert.equal(oggiIso(new Date("2026-09-30T23:30:00Z")), "2026-10-01");
  assert.equal(oggiIso(new Date("2026-09-30T21:30:00Z")), "2026-09-30");
});

test("un giorno è una data che esiste", () => {
  assert.equal(eUnGiorno("2026-10-05"), true);
  assert.equal(eUnGiorno("05/10/2026"), false);
  assert.equal(eUnGiorno(""), false);
  assert.equal(eUnGiorno(undefined), false);
});
