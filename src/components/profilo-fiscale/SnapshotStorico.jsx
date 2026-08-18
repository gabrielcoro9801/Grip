import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import moment from "moment";
import { Pencil, Trash2 } from "lucide-react";

export default function SnapshotStorico({ snapshots, currentId, onEdit, onDelete }) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Nessuno snapshot nello storico.</p>;
  }

  return (
    <div className="space-y-2">
      {snapshots.map(snap => {
        const isCurrent = snap.id === currentId;
        return (
          <div key={snap.id} className={`flex items-center justify-between p-3 rounded-lg border ${isCurrent ? "bg-emerald-50 border-emerald-200" : "bg-card"}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Decorrenza: {snap.data_decorrenza ? moment(snap.data_decorrenza).format("D MMM YYYY") : "—"}</span>
                {isCurrent && <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200">In vigore</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                Registrato il {snap.data_inserimento ? moment(snap.data_inserimento).format("D MMM YYYY, HH:mm") : "—"}
                {snap.regime_fiscale && ` · ${snap.regime_fiscale}`}
                {snap.forma_giuridica && ` · ${snap.forma_giuridica}`}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(snap)}><Pencil className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(snap)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}