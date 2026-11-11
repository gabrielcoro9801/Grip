import React, { useRef, useState } from "react";
import { Input } from "@/ui/primitivi/input";
import { cn } from "@/ui/utils";
import { leggiColore, hexAHsl, hslAHex } from "@/core/domain/colore";

// Il colore di una categoria: un campo di testo e un box, niente di più. Il selettore del
// browser (`input type="color"`) aveva cursori e campi R, G, B di Edge, che non si potevano
// cambiare né tradurre.
//
// Il testo accetta `rgb(139, 92, 246)`, `139, 92, 246`, `#8b5cf6` e `8b5cf6`: chi chiama riceve
// il testo così com'è scritto e lo legge con `leggiColore`, che dice anche se è un colore.
//
// Il box è tinta (in orizzontale) per luminosità (in verticale), con la saturazione fissa al
// 100%: i grigi si ottengono solo scrivendo il codice. È una scelta: un secondo cursore per la
// saturazione serviva a pochi e confondeva tutti. Col mouse si clicca o si trascina; da tastiera
// le frecce spostano di 1, con Maiuscolo di 10.

const SATURAZIONE = 100;
const SFONDO_BOX = [
  "linear-gradient(to bottom, #fff 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0) 50%, #000 100%)",
  "linear-gradient(to right, #f00 0%, #ff0 16.667%, #0f0 33.333%, #0ff 50%, #00f 66.667%, #f0f 83.333%, #f00 100%)",
].join(", ");

const limita = (n, min, max) => Math.min(max, Math.max(min, n));

export default function SelettoreColore({ id, value, onChange, className }) {
  const colore = leggiColore(value);
  const idAiuto = `${id ?? "colore"}-aiuto`;

  // La posizione del punto nel box. Si tiene a parte perché dal codice non sempre si torna al
  // punto: il bianco e il nero hanno tutte le tinte, e un grigio scritto a mano non sta nel box.
  // Si riallinea quando il colore cambia da fuori (scritto nel campo, o una categoria diversa).
  const [punto, setPunto] = useState(() => puntoDi(colore));
  const [ultimo, setUltimo] = useState(colore);
  if (colore && colore !== ultimo) {
    setUltimo(colore);
    if (hslAHex({ h: punto.h, s: SATURAZIONE, l: punto.l }) !== colore) setPunto(puntoDi(colore));
  }

  const box = useRef(null);
  const sposta = (h, l) => {
    const nuovo = { h: limita(Math.round(h), 0, 360), l: limita(Math.round(l), 0, 100) };
    setPunto(nuovo);
    const hex = hslAHex({ h: nuovo.h, s: SATURAZIONE, l: nuovo.l });
    setUltimo(hex);
    onChange(hex);
  };
  const dalPuntatore = (e) => {
    const r = box.current.getBoundingClientRect();
    sposta(((e.clientX - r.left) / r.width) * 360, 100 - ((e.clientY - r.top) / r.height) * 100);
  };
  const premi = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    dalPuntatore(e);
  };
  const trascina = (e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) dalPuntatore(e);
  };
  const tasto = (e) => {
    const passo = e.shiftKey ? 10 : 1;
    const mosse = {
      ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo],
    };
    const mossa = mosse[e.key];
    if (!mossa) return;
    e.preventDefault();
    sposta(punto.h + mossa[0], punto.l + mossa[1]);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-md border border-input"
          style={{ background: colore ?? "transparent" }}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#8b5cf6"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={colore ? undefined : true}
          aria-describedby={idAiuto}
        />
      </div>
      <p id={idAiuto} className={cn("text-xs", colore ? "text-muted-foreground" : "text-destructive")}>
        {colore
          ? "Scrivi il codice, come #8b5cf6 o rgb(139, 92, 246), o scegli nel riquadro."
          : "Non è un colore: scrivilo come #8b5cf6, 8b5cf6, rgb(139, 92, 246) o 139, 92, 246."}
      </p>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Tinta e luminosità"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={punto.h}
        aria-valuetext={`Tinta ${punto.h}°, luminosità ${punto.l}%. Frecce sinistra e destra per la tinta, su e giù per la luminosità.`}
        className="relative h-32 w-full cursor-crosshair touch-none select-none rounded-md border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ background: SFONDO_BOX }}
        onPointerDown={premi}
        onPointerMove={trascina}
        onKeyDown={tasto}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{
            left: `${(punto.h / 360) * 100}%`,
            top: `${100 - punto.l}%`,
            background: hslAHex({ h: punto.h, s: SATURAZIONE, l: punto.l }),
          }}
        />
      </div>
    </div>
  );
}

// Dove sta un colore nel box: la sua tinta e la sua luminosità. La saturazione si perde: un
// colore spento finisce sul punto acceso con la stessa tinta e la stessa luce.
function puntoDi(colore) {
  const hsl = hexAHsl(colore);
  if (!hsl) return { h: 0, l: 50 };
  return { h: Math.round(hsl.h), l: Math.round(hsl.l) };
}
