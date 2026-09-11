import { useState, useEffect } from "react";
import { api } from "@/core/api/client";

// Cache a livello modulo: l'organizzazione è globale per l'app.
// Evita chiamate API ripetute quando più componenti usano useOrganization
// contemporaneamente.
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

    // I ruoli li crea il server. Questa chiamata serve solo alle installazioni fatte
    // prima che il passaggio si spostasse lì: è idempotente, e se i ruoli ci sono già non
    // fa nulla. Un errore qui non deve impedire di usare l'app — se ne accorgerà chi apre
    // la schermata dei ruoli, dove il problema è visibile.
    try {
      await api.organizzazione.bootstrapRuoli(org.id);
    } catch {
      /* l'utente non è amministratore, oppure i ruoli sono già a posto */
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