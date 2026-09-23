import test from "node:test";
import assert from "node:assert/strict";
import {
  statoSala, sospensioneCopre, sospensioneTocca, motivoSospensioneNonValida,
  descriviSospensione, messaggioSospensioneBloccata,
} from "./sale.js";

const SOSPESA = { name: "Sala Pesi", stato: "sospeso", sospesa_dal: "2026-10-01", sospesa_al: "2026-10-15" };
const ATTIVA = { name: "Sala Corsi", stato: "attivo", sospesa_dal: null, sospesa_al: null };

test("una sospensione ha un prima, un durante e un dopo", () => {
  assert.equal(statoSala(ATTIVA, "2026-10-05"), "attiva");
  assert.equal(statoSala(SOSPESA, "2026-09-23"), "programmata");
  assert.equal(statoSala(SOSPESA, "2026-10-01"), "sospesa");
  assert.equal(statoSala(SOSPESA, "2026-10-15"), "sospesa");
  // Passato il periodo la sala è di nuovo utilizzabile, anche se nessuno l'ha riaperta a mano.
  assert.equal(statoSala(SOSPESA, "2026-10-16"), "conclusa");
});

test("la sospensione copre i suoi estremi, e nient'altro", () => {
  assert.equal(sospensioneCopre(SOSPESA, "2026-09-30"), false);
  assert.equal(sospensioneCopre(SOSPESA, "2026-10-01"), true);
  assert.equal(sospensioneCopre(SOSPESA, "2026-10-15"), true);
  assert.equal(sospensioneCopre(SOSPESA, "2026-10-16"), false);
  assert.equal(sospensioneCopre(ATTIVA, "2026-10-05"), false);
});

test("un evento tocca la sospensione se i due periodi si sfiorano", () => {
  assert.equal(sospensioneTocca(SOSPESA, "2026-09-01", "2026-09-30"), false);
  assert.equal(sospensioneTocca(SOSPESA, "2026-09-01", "2026-10-01"), true);
  assert.equal(sospensioneTocca(SOSPESA, "2026-10-15", "2026-11-30"), true);
  assert.equal(sospensioneTocca(SOSPESA, "2026-10-16", "2026-11-30"), false);
});

test("un evento senza fine nota occupa la sala da lì in avanti", () => {
  // Un settimanale contato a occorrenze non sa in che giorno finisce: meglio rifiutarlo che
  // lasciargli generare lezioni dentro una sala chiusa.
  assert.equal(sospensioneTocca(SOSPESA, "2026-09-01", null), true);
  assert.equal(sospensioneTocca(SOSPESA, "2026-10-16", null), false);
});

test("sospendere vuol dire da una data a una data", () => {
  assert.equal(motivoSospensioneNonValida("2026-10-01", "2026-10-15"), null);
  assert.equal(motivoSospensioneNonValida("2026-10-01", "2026-10-01"), null);
  assert.ok(motivoSospensioneNonValida("", "2026-10-15"));
  assert.ok(motivoSospensioneNonValida("2026-10-01", ""));
  assert.ok(motivoSospensioneNonValida("2026-10-15", "2026-10-01"));
});

test("le date si leggono come le legge la segreteria", () => {
  assert.equal(descriviSospensione(SOSPESA), "Sospesa dal 01/10/2026 al 15/10/2026");
  assert.equal(descriviSospensione(ATTIVA), "");
});

test("il rifiuto dice quante lezioni ci sono e dove stanno", () => {
  const molte = messaggioSospensioneBloccata("Sala Pesi", "2026-10-01", "2026-10-15", ["2026-10-02", "2026-10-09", "2026-10-14"]);
  assert.match(molte, /ci sono 3 lezioni/);
  assert.match(molte, /dal 02\/10\/2026 al 14\/10\/2026/);
  const una = messaggioSospensioneBloccata("Sala Pesi", "2026-10-01", "2026-10-15", ["2026-10-02"]);
  assert.match(una, /c'è 1 lezione/);
  assert.match(una, /il 02\/10\/2026/);
});
