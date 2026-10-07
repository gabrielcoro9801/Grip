import React from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/staff/components/PageHeader";
import Bancone from "@/staff/components/ingressi/Bancone";
import AndamentoIngressi from "@/staff/components/ingressi/AndamentoIngressi";
import { useStaffAuth } from "@/staff/lib/StaffAuthContext";
import { canEdit } from "@/staff/lib/permissions";

const VISTE = [
  { valore: "bancone", etichetta: "Bancone" },
  { valore: "andamento", etichetta: "Andamento" },
];

/**
 * Gli ingressi in palestra: il bancone, dove si controlla e si registra chi entra, e l'andamento,
 * con l'affluenza e i soci che non vengono più. Non sono presenze alle lezioni.
 */
export default function Ingressi() {
  const { staffUser } = useStaffAuth();
  const [parametri, setParametri] = useSearchParams();
  const vista = parametri.get("vista") === "andamento" ? "andamento" : "bancone";
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Ingressi" description="Chi entra in palestra, se è in regola, e come si frequenta." />
      <div className="flex gap-2" role="tablist" aria-label="Vista">
        {VISTE.map((v) => (
          <button
            key={v.valore} type="button" role="tab" aria-selected={vista === v.valore}
            onClick={() => setParametri(v.valore === "bancone" ? {} : { vista: v.valore }, { replace: true })}
            className={`px-4 py-1.5 rounded-full text-sm border ${vista === v.valore ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
          >
            {v.etichetta}
          </button>
        ))}
      </div>
      {vista === "bancone" ? <Bancone puoRegistrare={canEdit(staffUser?.ruolo, "crm_members")} /> : <AndamentoIngressi />}
    </div>
  );
}
