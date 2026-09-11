import React from "react";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canAccess } from "@/staff/lib/permissions";
import AccessDenied from "@/staff/components/AccessDenied";

export default function PermissionGate({ module, action = "view", children }) {
  const { staffUser } = useStaffAuth();

  if (!canAccess(staffUser?.ruolo, module, action)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}