import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { parametroAllaData, valoreAllaData } from "../../shared/parametriFiscali.js";

/**
 * Le aliquote e le soglie di legge, con la data da cui valgono.
 *
 * Erano costanti importate direttamente dalle pagine. Il problema non era che fossero fisse
 * — sono legge — ma che valessero per qualunque data: ricalcolando un esercizio passato
 * dopo un cambio di aliquota si sarebbe ottenuto un numero sbagliato con l'aria di essere
 * giusto.
 *
 * Le righe sono poche e non cambiano mai durante una sessione, quindi si leggono una volta
 * sola e si tengono qui.
 */
let _cache = null;
let _promessa = null;

function carica() {
  if (_cache) return Promise.resolve(_cache);
  if (_promessa) return _promessa;
  _promessa = api.entities.ParametroFiscale.list().then((righe) => {
    _cache = righe;
    return righe;
  });
  return _promessa;
}

export function useParametriFiscali() {
  const [righe, setRighe] = useState(_cache);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    let vivo = true;
    carica().then((r) => { if (vivo) { setRighe(r); setLoading(false); } });
    return () => { vivo = false; };
  }, []);

  return {
    parametri: righe,
    loading,
    /** Il valore in vigore alla data; solleva se per quella data non è noto. */
    valore: (chiave, data) => valoreAllaData(righe ?? [], chiave, data),
    /** Come `valore` ma restituisce anche decorrenza e norma, o null se non c'è. */
    dettaglio: (chiave, data) => parametroAllaData(righe ?? [], chiave, data),
  };
}
