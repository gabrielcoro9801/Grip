import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StaffAuthProvider } from "@/staff/lib/StaffAuthContext";
import { queryClientInstance } from "@/staff/lib/query-client";
import AppLayout from "@/staff/components/AppLayout";

/**
 * Tutto ciò che serve al gestionale e a nessun altro.
 *
 * `StaffAuthProvider` avvolgeva l'applicazione intera, portale soci compreso: chi apriva il
 * portale dal telefono si scaricava comunque la sessione dello staff, la matrice dei
 * permessi che si porta dietro e react-query — roba che al socio non serve e che non deve
 * nemmeno poter chiedere. Stando qui, entra in scena solo quando si entra nel gestionale.
 *
 * È anche ciò che rende onesta la separazione delle due sessioni: in una data pagina vive
 * un solo contesto di autenticazione, quindi non c'è ambiguità su quale delle due chiavi
 * stia usando una chiamata all'API.
 */
export default function StaffShell() {
  return (
    <StaffAuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <AppLayout />
      </QueryClientProvider>
    </StaffAuthProvider>
  );
}
