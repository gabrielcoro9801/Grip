import React from "react";
import { Badge } from "@/components/ui/badge";

const STATUS_STYLES = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  expiring: "bg-amber-100 text-amber-700 border-amber-200",
  expired: "bg-red-100 text-red-700 border-red-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  waitlisted: "bg-amber-100 text-amber-700 border-amber-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
  Pending: "bg-blue-100 text-blue-700 border-blue-200",
  Shipped: "bg-amber-100 text-amber-700 border-amber-200",
  Delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Cancelled: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_LABELS = {
  active: "Attivo",
  expiring: "In scadenza",
  expired: "Scaduto",
  confirmed: "Confermato",
  waitlisted: "In lista d'attesa",
  cancelled: "Cancellato",
  Pending: "In attesa",
  Shipped: "Spedito",
  Delivered: "Consegnato",
  Cancelled: "Cancellato",
};

export default function StatusBadge({ status }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${STATUS_STYLES[status] || "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}