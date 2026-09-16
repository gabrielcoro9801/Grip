import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/primitivi/button";
import { Camera, X } from "lucide-react";
import { cn } from "@/ui/utils";

const FORMATI = "image/png,image/jpeg,image/webp";
// Lo stesso limite del server (app.js): dirlo prima evita di aspettare un caricamento rifiutato.
const DIMENSIONE_MASSIMA = 10 * 1024 * 1024;

const DIMENSIONI = {
  sm: "w-10 h-10 text-sm",
  md: "w-14 h-14 text-lg",
  lg: "w-28 h-28 text-3xl",
};

/** Le iniziali di nome e cognome: due lettere, anche con nomi composti. */
function iniziali(socio) {
  const nome = socio?.nome?.trim()?.[0] ?? "";
  const cognome = socio?.cognome?.trim()?.[0] ?? "";
  return (nome + cognome).toUpperCase() || (socio?.full_name?.trim()?.[0] ?? "?").toUpperCase();
}

/**
 * La faccia di un socio: la foto se c'è, le iniziali se no. La stessa nell'elenco e nella
 * scheda, così chi scorre l'elenco riconosce la persona che poi apre.
 */
export function AvatarSocio({ socio, src, size = "sm", className }) {
  const foto = src ?? socio?.foto_url;
  const [rotta, setRotta] = useState(false);
  useEffect(() => setRotta(false), [foto]);

  return (
    <div className={cn("rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden", DIMENSIONI[size], className)}>
      {foto && !rotta ? (
        <img src={foto} alt="" className="w-full h-full object-cover" onError={() => setRotta(true)} />
      ) : (
        <span className="font-bold text-primary" aria-hidden="true">{iniziali(socio)}</span>
      )}
    </div>
  );
}

/**
 * La scelta della foto in un modulo. Non carica niente: tiene il file scelto, e il modulo lo
 * carica al salvataggio — chiudere la finestra senza salvare non deve lasciare file orfani.
 *
 * @param socio     per le iniziali, finché la foto non c'è
 * @param attuale   l'indirizzo della foto già salvata, se c'è
 * @param file      il file scelto, o null
 * @param rimossa   true se la foto salvata va tolta
 * @param onChange  ({ file, rimossa }) => void
 */
export function SceltaFoto({ socio, attuale, file, rimossa = false, onChange }) {
  const input = useRef(null);
  const [anteprima, setAnteprima] = useState(null);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    if (!file) { setAnteprima(null); return undefined; }
    const url = URL.createObjectURL(file);
    setAnteprima(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scegli = (e) => {
    const scelto = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!scelto) return;
    if (scelto.size > DIMENSIONE_MASSIMA) {
      setErrore("La foto supera i 10 MB.");
      return;
    }
    setErrore("");
    onChange({ file: scelto, rimossa: false });
  };

  const mostrata = anteprima ?? (rimossa ? null : attuale);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3">
      <AvatarSocio socio={socio} src={mostrata ?? ""} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Foto profilo</p>
        <p className="text-xs text-muted-foreground">Facoltativa · PNG, JPG o WebP</p>
        {errore && <p className="text-xs text-destructive mt-1">{errore}</p>}
      </div>
      <input ref={input} type="file" accept={FORMATI} className="hidden" onChange={scegli} aria-label="Scegli la foto profilo" />
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          <Camera className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {mostrata ? "Cambia foto" : "Carica foto"}
        </Button>
        {mostrata && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Togli la foto"
            onClick={() => onChange({ file: null, rimossa: Boolean(attuale) })}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
