import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { seedChartOfAccounts, seedCausaliOperative } from "@/lib/accountingDefaults";

// Cache a livello modulo: l'organizzazione è globale per l'app.
// Evita chiamate API ripetute quando più componenti usano useOrganization
// contemporaneamente (es. Movimenti + CespitiTab), riducendo il burst
// che scatena il rate limit della piattaforma.
let _cachedOrg = null;
let _cachePromise = null;

function loadOrganization() {
  if (_cachedOrg) return Promise.resolve(_cachedOrg);
  if (_cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    const orgs = await base44.entities.Organization.list();
    let org = orgs[0];
    if (!org) {
      org = await base44.entities.Organization.create({ nome: "La mia palestra" });
    }
    const accounts = await seedChartOfAccounts(org.id);
    await seedCausaliOperative(org.id, accounts);
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