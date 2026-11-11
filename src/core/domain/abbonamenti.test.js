import test from "node:test";
import assert from "node:assert/strict";
import {
  dataFineAbbonamento, descriviDurata, motivoNonVendibile, motivoCambioStatoNonValido,
  ordinaTipi, aggiungiMesi, statisticheVenduti,
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
  assert.match(motivoCambioStatoNonValido("annullato", "attivo"), /non torna in vendita/);
  assert.ok(motivoCambioStatoNonValido("attivo", "chiuso"));
});

test("il listino: in vendita, sospesi, ritirati; la vendita chiusa in fondo al suo gruppo; poi il nome", () => {
  const tipi = [
    { name: "Zumba", stato: "annullato" },
    { name: "Trimestrale", stato: "attivo" },
    { name: "Estate", stato: "attivo", vendibile_fino_al: "2026-09-30" },
    { name: "Annuale", stato: "sospeso" },
    { name: "Mensile", stato: "attivo", vendibile_fino_al: "2026-12-31" },
    { name: "Bimestrale", stato: "attivo" },
  ];
  assert.deepEqual(ordinaTipi(tipi, "2026-11-03").map((t) => t.name),
    ["Bimestrale", "Mensile", "Trimestrale", "Estate", "Annuale", "Zumba"]);
  // L'ultimo giorno di vendita il tipo è ancora in vendita, e l'elenco passato non cambia.
  assert.deepEqual(ordinaTipi(tipi, "2026-09-30").slice(0, 2).map((t) => t.name), ["Bimestrale", "Estate"]);
  assert.equal(tipi[0].name, "Zumba");
});

test("aggiungiMesi: lo stesso giorno, o l'ultimo del mese se non esiste", () => {
  assert.equal(aggiungiMesi("2026-01-31", 1), "2026-02-28");
  assert.equal(aggiungiMesi("2028-01-31", 1), "2028-02-29");
  assert.equal(aggiungiMesi("2028-02-29", 12), "2029-02-28");
  assert.equal(aggiungiMesi("2026-11-03", 3), "2027-02-03");
  assert.equal(aggiungiMesi("2026-01-15", -1), "2025-12-15");
  assert.equal(aggiungiMesi("2026-03-31", -1), "2026-02-28");
  assert.equal(aggiungiMesi("", 1), null);
});

const abb = (member_id, start_date, end_date) => ({ member_id, start_date, end_date });

test("venduti per mese: il mese di oggi, quello prima, lo stesso dell'anno prima, confini compresi", () => {
  const s = statisticheVenduti([
    abb(1, "2026-11-01", "2026-11-30"), abb(2, "2026-11-30", "2026-12-29"),
    abb(3, "2026-10-01", "2026-10-31"), abb(4, "2026-10-31", "2026-11-30"),
    abb(5, "2025-11-01", "2025-11-30"), abb(6, "2025-10-31", "2025-11-30"), abb(7, "2025-12-01", "2025-12-31"),
  ], "2026-11-15");
  assert.deepEqual(s.mesi, { corrente: "2026-11", precedente: "2026-10", annoPrima: "2025-11" });
  assert.deepEqual(s.venduti, { corrente: 2, precedente: 2, annoPrima: 1 });
});

test("venduti a gennaio: il mese prima è dicembre dell'anno prima", () => {
  const s = statisticheVenduti([abb(1, "2025-12-31", "2026-01-30"), abb(2, "2025-01-10", "2025-02-09")], "2026-01-05");
  assert.deepEqual(s.mesi, { corrente: "2026-01", precedente: "2025-12", annoPrima: "2025-01" });
  assert.deepEqual(s.venduti, { corrente: 0, precedente: 1, annoPrima: 1 });
});

test("attivi oggi: chi finisce oggi sì, chi inizia domani no; i soci si contano una volta", () => {
  const s = statisticheVenduti([
    abb(1, "2026-10-04", "2026-11-03"), abb(1, "2026-11-04", "2026-12-03"),
    abb(2, "2026-11-03", "2026-12-02"), abb(3, "2026-09-01", "2026-11-02"),
    abb(1, "2026-08-01", "2027-07-31"),
  ], "2026-11-03");
  assert.equal(s.attivi, 3);
  assert.equal(s.sociAttivi, 2);
});

test("in scadenza: fra gli attivi, entro 1, 3 e 6 mesi, cumulativi e crescenti", () => {
  const s = statisticheVenduti([
    abb(1, "2026-11-01", "2026-11-03"), abb(2, "2026-11-01", "2026-12-03"), abb(3, "2026-11-01", "2026-12-04"),
    abb(4, "2026-11-01", "2027-02-03"), abb(5, "2026-11-01", "2027-05-03"), abb(6, "2026-11-01", "2027-05-04"),
    abb(7, "2026-12-01", "2026-12-15"),
  ], "2026-11-03");
  assert.deepEqual(s.inScadenza, [{ mesi: 1, abbonamenti: 2 }, { mesi: 3, abbonamenti: 4 }, { mesi: 6, abbonamenti: 5 }]);
  const [uno, tre, sei] = s.inScadenza.map((x) => x.abbonamenti);
  assert.ok(uno <= tre && tre <= sei && sei <= s.attivi);
});

test("nessun abbonamento: tutti zero", () => {
  const s = statisticheVenduti([], "2026-11-03");
  assert.deepEqual(s.venduti, { corrente: 0, precedente: 0, annoPrima: 0 });
  assert.equal(s.attivi, 0);
  assert.equal(s.sociAttivi, 0);
});
