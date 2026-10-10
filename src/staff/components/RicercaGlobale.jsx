import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/core/api/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/ui/primitivi/dialog";
import { Input } from "@/ui/primitivi/input";
import StatusBadge from "@/ui/StatusBadge";
import { Search } from "lucide-react";

const TIPI = {
  socio: { etichetta: "Socio", tono: "positivo" },
  ex_socio: { etichetta: "Archiviato", tono: "neutro" },
  contatto_aperto: { etichetta: "Contatto", tono: "info" },
  contatto: { etichetta: "Contatto chiuso", tono: "neutro" },
};
// Si cerca quando si smette di scrivere, non a ogni lettera.
const ATTESA_MS = 200;

/** Dove porta un risultato: la scheda del socio, o il contatto fra i lead (anche fra i chiusi). */
function destinazione(r) {
  if (r.socio_id) return `/crm/soci/${r.socio_id}`;
  const q = encodeURIComponent(r.nome);
  return r.tipo === "contatto_aperto" ? `/lead?q=${q}` : `/lead?vista=chiusi&q=${q}`;
}

/**
 * La ricerca di una persona da qualunque pagina, con Ctrl+K (⌘K sul Mac): nome, telefono scritto
 * come capita, codice fiscale o codice socio. Invio apre il primo risultato.
 */
export default function RicercaGlobale({ aperta, onAperta }) {
  const navigate = useNavigate();
  const [testo, setTesto] = useState("");
  const [risultati, setRisultati] = useState([]);
  const [scelto, setScelto] = useState(0);
  const ultima = useRef(0);

  useEffect(() => {
    const tasto = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onAperta(true);
      }
    };
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [onAperta]);

  useEffect(() => {
    if (!aperta) { setTesto(""); setRisultati([]); }
  }, [aperta]);

  useEffect(() => {
    const q = testo.trim();
    if (q.length < 2) { setRisultati([]); return undefined; }
    const questa = ++ultima.current;
    const timer = setTimeout(() => {
      api.persone.cerca(q)
        .then(({ risultati: r }) => { if (questa === ultima.current) { setRisultati(r); setScelto(0); } })
        .catch(() => setRisultati([]));
    }, ATTESA_MS);
    return () => clearTimeout(timer);
  }, [testo]);

  const apri = (r) => {
    onAperta(false);
    navigate(destinazione(r));
  };

  const tasti = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setScelto((i) => Math.min(i + 1, risultati.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setScelto((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && risultati[scelto]) { e.preventDefault(); apri(risultati[scelto]); }
  };

  return (
    <Dialog open={aperta} onOpenChange={onAperta}>
      <DialogContent className="max-w-lg p-0 gap-0 top-[15%] translate-y-0">
        <DialogTitle className="sr-only">Cerca una persona</DialogTitle>
        <DialogDescription className="sr-only">Nome, telefono, codice fiscale o codice socio.</DialogDescription>
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <Input
            autoFocus value={testo} onChange={(e) => setTesto(e.target.value)} onKeyDown={tasti}
            placeholder="Nome, telefono, codice fiscale o codice socio"
            aria-label="Cerca una persona" role="combobox" aria-expanded={risultati.length > 0} aria-controls="ricerca-risultati"
            className="border-0 shadow-none focus-visible:ring-0 h-12"
          />
        </div>
        <ul id="ricerca-risultati" role="listbox" className="max-h-80 overflow-y-auto py-1">
          {testo.trim().length >= 2 && risultati.length === 0 && (
            <li className="px-4 py-6 text-sm text-center text-muted-foreground">Nessuno trovato.</li>
          )}
          {risultati.map((r, i) => (
            <li key={r.persona_id} role="option" aria-selected={i === scelto}>
              <button
                type="button" onClick={() => apri(r)} onMouseEnter={() => setScelto(i)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left ${i === scelto ? "bg-muted" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{r.nome}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {[r.codice_socio, r.telefono].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <StatusBadge status={r.tipo} label={TIPI[r.tipo]?.etichetta} tone={TIPI[r.tipo]?.tono} className="shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
