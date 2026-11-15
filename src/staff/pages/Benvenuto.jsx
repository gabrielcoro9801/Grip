import React from "react";
import { Link } from "react-router-dom";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { vociVisibili } from "@/staff/components/AppLayout";

/**
 * La pagina di arrivo per chi non ha la dashboard: il suo nome, il suo ruolo, e un riquadro per
 * ogni sezione che può aprire. Chi non ne ha nessuna lo dice, e chiede all'amministratore.
 */
export default function Benvenuto() {
  const { staffUser } = useStaffAuth();
  const sezioni = vociVisibili(staffUser).filter((v) => v.path !== "/");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Ciao {staffUser?.nome}</h1>
        <p className="text-sm text-muted-foreground mt-1">Hai effettuato l'accesso come {staffUser?.ruolo_label}.</p>
      </div>

      {sezioni.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sezioni.map((v) => {
            const Icona = v.icon;
            return (
              <Link
                key={v.path}
                to={v.path}
                className="group rounded-lg bg-card shadow-sm p-4 hover:shadow-md transition-shadow flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="bg-primary/10 p-2 rounded-lg text-primary">
                  <Icona className="w-5 h-5" aria-hidden="true" />
                </div>
                <p className="font-medium">{v.label}</p>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg bg-card shadow-sm p-6">
          <p className="font-medium">Nessuna sezione per il tuo ruolo</p>
          <p className="text-sm text-muted-foreground mt-1">Chiedi all'amministratore di assegnarti i permessi che ti servono.</p>
        </div>
      )}
    </div>
  );
}
