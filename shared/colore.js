// Il colore di una categoria: come si scrive, e come si passa dal codice al box del selettore.
//
// Si accetta il colore come lo copia chi lo prende da un altro programma: `rgb(139, 92, 246)`,
// `139, 92, 246`, `#8b5cf6` o `8b5cf6`. Si salva sempre `#rrggbb` minuscolo, così il server e le
// schermate leggono una forma sola. Il server usa questa stessa regola: un colore che il modulo
// accetta il server non lo rifiuta, e viceversa.

const HEX = /^#?([0-9a-f]{6})$/i;
const RGB = /^(?:rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)|(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3}))$/i;

const dueCifre = (n) => n.toString(16).padStart(2, '0');

/**
 * Un colore scritto in uno dei quattro modi accettati, come `#rrggbb` minuscolo.
 * Restituisce null se il testo non è un colore, o se un canale va oltre 255.
 */
export function leggiColore(valore) {
	if (typeof valore !== 'string') return null;
	const testo = valore.trim();
	const hex = HEX.exec(testo);
	if (hex) return `#${hex[1].toLowerCase()}`;
	const rgb = RGB.exec(testo);
	if (!rgb) return null;
	const canali = (rgb[1] !== undefined ? rgb.slice(1, 4) : rgb.slice(4, 7)).map(Number);
	if (canali.some((c) => c > 255)) return null;
	return `#${canali.map(dueCifre).join('')}`;
}

/**
 * Da un colore accettato da `leggiColore` a tinta (0-360), saturazione e luminosità (0-100).
 * I numeri non si arrotondano: così `hslAHex(hexAHsl(x))` torna esattamente `x`.
 */
export function hexAHsl(valore) {
	const hex = leggiColore(valore);
	if (!hex) return null;
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return { h: 0, s: 0, l: l * 100 };
	const s = d / (1 - Math.abs(2 * l - 1));
	let h;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	if (h < 0) h += 360;
	return { h, s: s * 100, l: l * 100 };
}

/** Da tinta (0-360), saturazione e luminosità (0-100) a `#rrggbb` minuscolo. */
export function hslAHex({ h, s, l }) {
	const tinta = ((Number(h) % 360) + 360) % 360;
	const sat = Math.min(100, Math.max(0, Number(s))) / 100;
	const lum = Math.min(100, Math.max(0, Number(l))) / 100;
	const c = (1 - Math.abs(2 * lum - 1)) * sat;
	const x = c * (1 - Math.abs(((tinta / 60) % 2) - 1));
	const m = lum - c / 2;
	const [r, g, b] =
		tinta < 60 ? [c, x, 0]
			: tinta < 120 ? [x, c, 0]
				: tinta < 180 ? [0, c, x]
					: tinta < 240 ? [0, x, c]
						: tinta < 300 ? [x, 0, c]
							: [c, 0, x];
	return `#${[r, g, b].map((v) => dueCifre(Math.round((v + m) * 255))).join('')}`;
}
