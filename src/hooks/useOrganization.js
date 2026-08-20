import { useState, useEffect } from "react";
import { api } from "@/api/client";

// Cache a livello modulo: l'organizzazione è globale per l'app.
// Evita chiamate API ripetute quando più componenti usano useOrganization
// contemporaneamente (es. Movimenti + CespitiTab).
let _cachedOrg = null;
let _cachePromise = null;

function loadOrganization() {
  if (_cachedOrg) return Promise.resolve(_cachedOrg);
  if (_cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    const orgs = await api.entities.Organization.list();
    const org = orgs[0];
    if (!org) {
      // L'organizzazione la crea `npm run db:seed`, insieme al primo account: qui non si
      // inventa un ente con un nome di fantasia. Se manca, l'installazione è incompleta e
      // va detto, non aggirato.
      throw new Error(
        "Nessuna organizzazione configurata. Esegui `npm run db:seed` nella cartella server.",
      );
    }

    // Piano dei conti e causali li crea il server. Questa chiamata serve solo alle
    // installazioni fatte prima che il passaggio si spostasse lì: è idempotente, e se la
    // contabilità c'è già non fa nulla. Un errore qui non deve impedire di usare l'app —
    // se ne accorgerà chi apre il piano dei conti, dove il problema è visibile.
    try {
      await api.accounting.bootstrapContabilita(org.id);
    } catch {
      /* l'utente non è amministratore, oppure la contabilità è già a posto */
    }

    _cachedOrg = org;
    return org;
  })();
  return _cachePromise;
}

export function useOrganization() {
  const [organization, setOrganization] = useState(_cachedOrg);
  const [loading, setLoading] = useState(!_cachedOrg);

  useEffect(() => {
    if (_cachedOrg) return;
    let cancelled = false;
    loadOrganization().then((org) => {
      if (!cancelled) {
        setOrganization(org);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { organization, loading };
}