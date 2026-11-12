import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { api } from "@/core/api/client";
import SectionTabs from "@/staff/components/SectionTabs";
import PageContainer from "@/staff/components/PageContainer";
import { SCHEDE } from "@/staff/components/dafare/avvisi";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";

/**
 * Da fare: la barra delle cinque schede, l'Archivio e, per l'amministratore, le Regole. Come in
 * Soci e Lead, una voce per scheda e un indirizzo per voce.
 *
 * Accanto a ogni scheda il numero degli avvisi aperti. Lo porta ogni lettura degli avvisi
 * (GET /api/avvisi, `conteggi`): la pagina sotto lo passa alla barra con `aggiornaConteggi`, dal
 * contesto dell'Outlet. Le Regole non leggono avvisi: i numeri li chiede la barra, e dopo un
 * salvataggio li richiedono loro (`ricaricaConteggi`), perché un avviso spento non si conta.
 */
export default function DaFareLayout() {
  const { pathname } = useLocation();
  const { staffUser } = useStaffAuth();
  const [conteggi, setConteggi] = useState(null);

  const ricaricaConteggi = useCallback(() => {
    // Basta la scheda più corta: i conteggi arrivano con ogni lettura.
    api.avvisi.lista({ tipo: "compleanno" }).then((d) => setConteggi(d.conteggi)).catch(() => {});
  }, []);

  const inRegole = pathname.startsWith("/da-fare/regole");
  useEffect(() => { if (inRegole && !conteggi) ricaricaConteggi(); }, [inRegole, conteggi, ricaricaConteggi]);

  const tabs = useMemo(() => [
    ...SCHEDE.map((s) => ({ label: s.etichetta, path: s.path, end: s.path === "/da-fare", conta: conteggi?.[s.tipo] })),
    { label: "Archivio", path: "/da-fare/archivio" },
    ...(canEdit(staffUser?.ruolo, "admin_users") ? [{ label: "Regole", path: "/da-fare/regole" }] : []),
  ], [conteggi, staffUser?.ruolo]);

  const contesto = useMemo(() => ({ conteggi, aggiornaConteggi: setConteggi, ricaricaConteggi }), [conteggi, ricaricaConteggi]);

  return (
    <div className="flex flex-col h-full">
      <SectionTabs tabs={tabs} label="Schede di Da fare" />
      <div className="flex-1 overflow-y-auto">
        <PageContainer>
          <Outlet context={contesto} />
        </PageContainer>
      </div>
    </div>
  );
}
