// Come Grip scrive date e denaro.
//
// Il file è nato per fare da rete alla sostituzione di `moment` con `Intl`: una
// sostituzione fatta senza una rete sotto è il modo migliore di spostare di un giorno tutte
// le scadenze degli abbonamenti **senza che nessuno se ne accorga** — perché una data
// sbagliata non solleva errori, si limita a essere sbagliata.
//
// Quindi qui non si giudica se il comportamento sia bello: lo si fissa. Chi cambia
// `format.js` saprà subito se ha cambiato qualcosa, e cosa.
//
// Gira con `node --test`, senza browser: è anche la prova che questo pezzo di core sia
// trasportabile.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatEuro, formatData, formatDataOra, toIsoDate, FORMATI_DATA } from './format.js';

// Gli spazi che Intl mette fra numero e valuta non sono spazi normali: confrontarli
// letteralmente renderebbe i test fragili senza dire niente di utile.
const normalizza = (s) => String(s).replace(/ | /g, ' ');

describe('il denaro come lo scrive un italiano', () => {
  test('euro con la virgola decimale', () => {
    // In italiano il raggruppamento delle migliaia parte da **cinque** cifre: `1234,50 €`
    // è corretto e `1.234,50 €` sarebbe sbagliato. È una regola del locale (CLDR), non una
    // stranezza di questo codice, e vale la pena fissarla: sembra un difetto e non lo è.
    assert.equal(normalizza(formatEuro(1234.5)), '1234,50 €');
    assert.equal(normalizza(formatEuro(12345.5)), '12.345,50 €');
    assert.equal(normalizza(formatEuro(0)), '0,00 €');
  });

  test('quando manca si scrive il trattino, non zero', () => {
    // Zero e "non lo so" sono due cose diverse, e in un bilancio confonderle è grave.
    assert.equal(formatEuro(null), '—');
    assert.equal(formatEuro(undefined), '—');
    assert.equal(formatEuro(''), '—');
    assert.equal(formatEuro('non un numero'), '—');
    assert.equal(formatEuro(null, { vuoto: 'n.d.' }), 'n.d.');
  });

  test('arrotondare non perde il mezzo centesimo', () => {
    // È il caso che `Math.round(v * 100)` e Intl sbagliano da soli: 1.005 in binario sta
    // appena sotto, e arrotonderebbe per difetto.
    assert.equal(normalizza(formatEuro(1.005)), '1,01 €');
    assert.equal(normalizza(formatEuro(2.675)), '2,68 €');
    assert.equal(normalizza(formatEuro(-1.005)), '-1,01 €');
  });
});

describe('le date', () => {
  // **Il caso che conta più di tutti.** Le date "solo giorno" arrivano dal server come
  // stringa YYYY-MM-DD. `new Date("2026-01-31")` le legge come mezzanotte UTC, e in un fuso
  // dietro Greenwich diventano il 30. moment sulla stringa nuda le tratta come data locale,
  // che è quello che serve: la scadenza di un abbonamento è un giorno sul calendario, non
  // un istante.
  //
  // Chi toglierà moment deve far passare questo test senza cambiarlo.
  test('una data nuda resta il giorno che è', () => {
    assert.equal(formatData('2026-01-31', 'breve'), '31/01/2026');
    assert.equal(formatData('2026-01-01', 'breve'), '01/01/2026');
    assert.equal(formatData('2026-12-31', 'iso'), '2026-12-31');
    assert.equal(toIsoDate('2026-01-31'), '2026-01-31');
  });

  test('i formati previsti, in italiano', () => {
    assert.equal(formatData('2026-01-31', 'breve'), '31/01/2026');
    assert.equal(formatData('2026-01-31', 'giornoMese'), '31/01');
    assert.match(formatData('2026-01-31', 'media'), /31 gen/i);
    assert.match(formatData('2026-01-31', 'estesa'), /sabato 31 gennaio 2026/i);
    assert.match(formatData('2026-01-31', 'estesaBreve'), /sabato 31 gennaio/i);
    assert.match(formatData('2026-01-31', 'giorno'), /sab 31 gen/i);
    assert.match(formatData('2026-01-31', 'mese'), /gennaio 2026/i);
  });

  test("l'elenco dei formati è quello dichiarato", () => {
    // Se qualcuno ne aggiunge uno, questo test lo fa notare: i modi di scrivere una data
    // erano dodici e più prima che venissero ridotti a questi.
    assert.deepEqual(
      Object.keys(FORMATI_DATA).sort(),
      [
        'breve', 'estesa', 'estesaBreve', 'giorno', 'giornoBreve', 'giornoMese',
        'giornoMeseLungo', 'giornoNumero', 'iso', 'media', 'mese', 'settimanaBreve',
      ]
    );
  });

  test("un istante porta con sé l'ora", () => {
    const istante = '2026-01-31T14:30:00';
    assert.equal(formatDataOra(istante), '31/01/2026 14:30');
    assert.equal(formatDataOra(istante, { secondi: true }), '31/01/2026 14:30:00');
    assert.equal(formatData(istante, 'breve', { ora: true }), '31/01/2026 14:30');
  });

  test('i nomi di mesi e giorni non hanno il punto', () => {
    // Intl in italiano abbrevia con il punto ("gen."), moment senza. Le schermate sono
    // sempre state senza: "sab. 31 gen." sembra un refuso, non un'abbreviazione.
    assert.equal(formatData('2026-01-31', 'giorno'), 'sab 31 gen');
    assert.equal(formatData('2026-01-31', 'giornoBreve'), '31 gen');
    assert.equal(formatData('2026-01-31', 'media'), '31 gen 2026');
  });

  test('quando manca, o non è una data, si scrive il trattino', () => {
    for (const niente of [null, undefined, '', 'non una data']) {
      assert.equal(formatData(niente), '—');
      assert.equal(formatDataOra(niente), '—');
    }
    assert.equal(toIsoDate(null), '');
    assert.equal(formatData(null, 'breve', { vuoto: 'mai' }), 'mai');
  });
});
