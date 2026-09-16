import test from "node:test";
import assert from "node:assert/strict";
import {
  dataFineAbbonamento, descriviDurata, motivoNonVendibile, motivoCambioStatoNonValido,
} from "./abbonamenti.js";

test("un mese è un mese di calendario, non 30 giorni", () => {
  assert.equal(dataFineAbbonamento("2026-09-01", 1, "mesi"), "2026-09-30");
  assert.equal(dataFineAbbonamento("2026-09-16", 1, "mesi"), "2026-10-15");
  assert.equal(dataFineAbbonamento("2026-02-01", 1, "mesi"), "2026-02-28");
  assert.equal(dataFineAbbonamento("2026-11-15", 3, "mesi"), "2027-02-14");
});

test("se il giorno di partenza non esiste nel mese d'arrivo, si arriva all'ultimo", () => {
  assert.equal(dataFineAbbonamento("2026-01-31", 1, "mesi"), "2026-02-28");
  assert.equal(dataFineAbbonamento("2028-01-31", 1, "mesi"), "2028-02-29");
});

test("anni e giorni", () => {
  assert.equal(dataFineAbbonamento("2026-01-01", 1, "anni"), "2026-12-31");
  assert.equal(dataFineAbbonamento("2028-02-29", 1, "anni"), "2029-02-28");
  assert.equal(dataFineAbbonamento("2026-09-01", 30, "giorni"), "2026-09-30");
  assert.equal(dataFineAbbonamento("2026-09-01", 1, "giorni"), "2026-09-01");
});

test("una durata senza senso non dà una data", () => {
  assert.equal(dataFineAbbonamento("2026-09-01", 0, "mesi"), null);
  assert.equal(dataFineAbbonamento("2026-09-01", 1, "settimane"), null);
  assert.equal(dataFineAbbonamento("", 1, "mesi"), null);
});

test("la durata si legge al singolare e al plurale", () => {
  assert.equal(descriviDurata(1, "mesi"), "1 mese");
  assert.equal(descriviDurata(6, "mesi"), "6 mesi");
  assert.equal(descriviDurata(1, "anni"), "1 anno");
});

test("si vende solo un tipo attivo, entro la sua data massima", () => {
  const tipo = { name: "Mensile", stato: "attivo", vendibile_fino_al: "2026-12-31" };
  assert.equal(motivoNonVendibile(tipo, "2026-12-31"), null);
  assert.match(motivoNonVendibile(tipo, "2027-01-01"), /fino al/);
  assert.equal(motivoNonVendibile({ ...tipo, vendibile_fino_al: null }, "2099-01-01"), null);
  assert.match(motivoNonVendibile({ ...tipo, stato: "sospeso" }, "2026-01-01"), /sospeso/);
});

test("annullato è definitivo, sospeso no", () => {
  assert.equal(motivoCambioStatoNonValido("sospeso", "attivo"), null);
  assert.equal(motivoCambioStatoNonValido("attivo", "annullato"), null);
  assert.match(motivoCambioStatoNonValido("annullato", "attivo"), /non si riattiva/);
  assert.ok(motivoCambioStatoNonValido("attivo", "chiuso"));
});
