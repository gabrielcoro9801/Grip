import React from "react";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canAccess } from "@/staff/lib/permissions";
import AccessDenied from "@/staff/components/AccessDenied";

/** `module` può essere un elenco: basta uno dei moduli. */
export default function PermissionGate({ module, action = "view", children }) {
  const { staffUser } = useStaffAuth();
  const moduli = Array.isArray(module) ? module : [module];

  if (!moduli.some((m) => canAccess(staffUser?.ruolo, m, action))) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}