import React from "react";
import { useStaffAuth } from "@/lib/StaffAuthContext";
import { canAccess } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";

export default function PermissionGate({ module, action = "view", children }) {
  const { staffUser } = useStaffAuth();

  if (!canAccess(staffUser?.ruolo, module, action)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}