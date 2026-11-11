import test from "node:test";
import assert from "node:assert/strict";
import { leggiColore, hexAHsl, hslAHex } from "./colore.js";

test("i quattro modi di scrivere un colore danno lo stesso #rrggbb", () => {
  assert.equal(leggiColore("rgb(139, 92, 246)"), "#8b5cf6");
  assert.equal(leggiColore("139, 92, 246"), "#8b5cf6");
  assert.equal(leggiColore("#8b5cf6"), "#8b5cf6");
  assert.equal(leggiColore("8b5cf6"), "#8b5cf6");
  // Maiuscole, spazi in più o in meno.
  assert.equal(leggiColore("  #8B5CF6 "), "#8b5cf6");
  assert.equal(leggiColore("RGB(139,92,246)"), "#8b5cf6");
  assert.equal(leggiColore("0, 0, 0"), "#000000");
});

test("quello che non è un colore dà null", () => {
  for (const valore of ["", "blu", "#8b5cf", "#8b5cf6a", "#gggggg", "139, 92", "rgb(139, 92, 246", "139, 92, 246)", "1.5, 2, 3", "-1, 0, 0", null, undefined, 0x8b5cf6]) {
    assert.equal(leggiColore(valore), null, String(valore));
  }
});

test("un canale oltre 255 non è un colore", () => {
  assert.equal(leggiColore("rgb(256, 0, 0)"), null);
  assert.equal(leggiColore("0, 300, 0"), null);
  assert.equal(leggiColore("0, 0, 999"), null);
  assert.equal(leggiColore("255, 255, 255"), "#ffffff");
});

test("da hex a hsl e ritorno si torna allo stesso colore", () => {
  assert.deepEqual(hexAHsl("#ff0000"), { h: 0, s: 100, l: 50 });
  assert.equal(hslAHex({ h: 240, s: 100, l: 50 }), "#0000ff");
  assert.equal(hslAHex({ h: 120, s: 100, l: 100 }), "#ffffff");
  assert.equal(hslAHex({ h: 120, s: 100, l: 0 }), "#000000");
  assert.equal(hslAHex({ h: 360, s: 100, l: 50 }), "#ff0000");
  assert.equal(hexAHsl("non un colore"), null);
  for (const hex of ["#8b5cf6", "#3b82f6", "#000000", "#ffffff", "#808080", "#123456", "#fedcba", "#00ff7f", "#ff00ff"]) {
    assert.equal(hslAHex(hexAHsl(hex)), hex, hex);
  }
});
