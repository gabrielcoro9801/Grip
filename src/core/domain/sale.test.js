import test from "node:test";
import assert from "node:assert/strict";
import {
  statoSala, sospensioneTocca, motivoSospensioneNonValida,
  descriviSospensione, messaggioSospensioneBloccata, messaggioAnnullaInveceDiEliminare,
  azioneSullaSala, motivoSalaNonPrenotabile, motivoCambioStatoNonValido,
  saleProgrammabili, etichettaSalaNelPeriodo,
} from "./sale.js";

const SOSPESA = { name: "Sala Pesi", stato: "sospeso", sospesa_dal: "2026-10-01", sospesa_al: "2026-10-15" };
const ATTIVA = { name: "Sala Corsi", stato: "attivo", sospesa_dal: null, sospesa_al: null };
const ANNULLATA = { name: "Sala Vecchia", stato: "annullato", sospesa_dal: null, sospesa_al: null };

test("una sospensione ha un prima, un durante e un dopo", () => {
  assert.equal(statoSala(ATTIVA, "2026-10-05"), "attiva");
  assert.equal(statoSala(SOSPESA, "2026-09-23"), "programmata");
  assert.equal(statoSala(SOSPESA, "2026-10-01"), "sospesa");
  assert.equal(statoSala(SOSPESA, "2026-10-15"), "sospesa");
  // Passato il periodo la sala è di nuovo utilizzabile, anche se nessuno l'ha riaperta a mano.
  assert.equal(statoSala(SOSPESA, "2026-10-16"), "conclusa");
});

test("la sospensione copre i suoi estremi, e nient'altro", () => {
  // Una lezione è un periodo di un giorno solo.
  const tocca = (sala, giorno) => sospensioneTocca(sala, giorno, giorno);
  assert.equal(tocca(SOSPESA, "2026-09-30"), false);
  assert.equal(tocca(SOSPESA, "2026-10-01"), true);
  assert.equal(tocca(SOSPESA, "2026-10-15"), true);
  assert.equal(tocca(SOSPESA, "2026-10-16"), false);
  assert.equal(tocca(ATTIVA, "2026-10-05"), false);
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

test("cosa si può fare di una sala dipende da quanto si perderebbe", () => {
  // Mai collegata a un evento: non è mai stata niente per nessuno.
  assert.equal(azioneSullaSala({ maiUsata: true, occupataDaQui: false }), "elimina");
  // Solo eventi passati: eliminarla toglierebbe il «dove» a lezioni già fatte.
  assert.equal(azioneSullaSala({ maiUsata: false, occupataDaQui: false }), "annulla");
  // Lezioni da qui in avanti: ci sono soci prenotati, non si tocca.
  assert.equal(azioneSullaSala({ maiUsata: false, occupataDaQui: true }), "niente");
  // Una sala nuova e già prenotata resta intoccabile: conta il calendario, non l'anzianità.
  assert.equal(azioneSullaSala({ maiUsata: true, occupataDaQui: true }), "niente");
  // Già annullata con un passato: è già dove deve stare, non si annulla una seconda volta.
  assert.equal(azioneSullaSala({ maiUsata: false, occupataDaQui: false, annullata: true }), "niente");
  // Già annullata ma mai usata: si può ancora eliminare davvero.
  assert.equal(azioneSullaSala({ maiUsata: true, occupataDaQui: false, annullata: true }), "elimina");
});

test("il messaggio dell'annullamento dice cosa si salva e cosa si perde, in italiano", () => {
  const molti = messaggioAnnullaInveceDiEliminare("Sala Pesi", { eventi: 3 });
  // Con tre eventi diceva «c'è 3 eventi».
  assert.match(molti, /ci sono 3 eventi che si sono tenuti/);
  assert.match(molti, /Si annulla/);
  assert.match(messaggioAnnullaInveceDiEliminare("Sala Pesi", { eventi: 1 }), /c'è 1 evento che si è tenuto/);
  // Solo lezioni spostate qui da un evento di un'altra sala: sono lezioni, non eventi.
  assert.match(messaggioAnnullaInveceDiEliminare("Sala Pesi", { lezioni: 12 }), /ci sono 12 lezioni che si sono tenute/);
});

test("le tendine: niente sale annullate, e il motivo detto sul periodo scelto", () => {
  const attiva = { id: "a", name: "Pesi", stato: "attivo" };
  const sospesa = { id: "s", name: "Yoga", stato: "sospeso", sospesa_dal: "2026-10-01", sospesa_al: "2026-10-15" };
  const annullata = { id: "x", name: "Vecchia", stato: "annullato" };
  assert.deepEqual(saleProgrammabili([attiva, sospesa, annullata]).map((s) => s.id), ["a", "s"]);
  assert.equal(etichettaSalaNelPeriodo(sospesa, "2026-10-10", "2026-10-10"), "Yoga — sospesa dal 01/10/2026 al 15/10/2026");
  // Fuori dal periodo la sala funziona: niente etichetta, qualunque cosa dica il calendario di oggi.
  assert.equal(etichettaSalaNelPeriodo(sospesa, "2026-11-01", "2026-11-01"), "Yoga");
});

test("una sala annullata non si prenota mai, in nessuna data", () => {
  assert.equal(statoSala(ANNULLATA), "annullata");
  // Non guarda le date: non è più una sala.
  assert.match(motivoSalaNonPrenotabile(ANNULLATA, "2026-01-01", "2026-01-01"), /annullata/);
  assert.match(motivoSalaNonPrenotabile(ANNULLATA, "2030-06-01", null), /annullata/);
  assert.equal(motivoSalaNonPrenotabile(ATTIVA, "2026-10-05", "2026-10-05"), null);
  // Sospesa vale solo dentro il suo periodo: fuori, la stanza funziona come sempre.
  assert.match(motivoSalaNonPrenotabile(SOSPESA, "2026-10-05", "2026-10-05"), /sospesa dal/);
  assert.equal(motivoSalaNonPrenotabile(SOSPESA, "2026-11-05", "2026-11-05"), null);
});

test("annullare è definitivo: non si torna indietro", () => {
  assert.equal(motivoCambioStatoNonValido("attivo", "annullato"), null);
  assert.equal(motivoCambioStatoNonValido("sospeso", "annullato"), null);
  assert.equal(motivoCambioStatoNonValido("annullato", "annullato"), null);
  assert.ok(motivoCambioStatoNonValido("annullato", "attivo"));
  assert.ok(motivoCambioStatoNonValido("annullato", "sospeso"));
  assert.ok(motivoCambioStatoNonValido("attivo", "chiuso"));
});
