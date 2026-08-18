import React from "react";
import { ShieldX } from "lucide-react";

export default function AccessDenied({ message }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldX className="w-8 h-8 text-destructive" />
      </div>
      <h2 className="text-xl font-heading font-semibold mb-2">Accesso negato</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {message || "Non hai i permessi per visualizzare questa sezione."}
      </p>
    </div>
  );
}