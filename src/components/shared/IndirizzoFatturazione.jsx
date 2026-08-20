import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Indirizzo scomposto nei campi che il tracciato della fattura elettronica richiede.
 *
 * Altrove nell'app l'indirizzo è una riga di testo libero, e per un PDF va benissimo. Qui
 * no: CAP, comune e provincia sono elementi distinti dell'XML e vanno validati per conto
 * loro, quindi si raccolgono separati invece di provare a spezzare a posteriori una riga
 * scritta a mano — operazione che sbaglia su qualunque indirizzo fuori dallo schema atteso.
 *
 * Usato sia per la sede dell'associazione sia per quella del cliente: sono lo stesso
 * blocco del tracciato.
 */
export default function IndirizzoFatturazione({ valori, onChange, prefisso = "indirizzo" }) {
  const campo = (suffisso) => `${prefisso}_${suffisso}`;
  const set = (suffisso, valore) => onChange({ ...valori, [campo(suffisso)]: valore });
  const val = (suffisso) => valori[campo(suffisso)] || "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <Label>Via / Piazza</Label>
          <Input value={val("via")} onChange={(e) => set("via", e.target.value)} placeholder="Via Roma" maxLength={60} />
        </div>
        <div className="w-24">
          <Label>Civico</Label>
          <Input value={val("civico")} onChange={(e) => set("civico", e.target.value)} placeholder="10" maxLength={8} />
        </div>
      </div>
      <div className="grid grid-cols-[6rem_1fr_5rem] gap-3">
        <div>
          <Label>CAP</Label>
          <Input
            value={val("cap")}
            // Il tracciato vuole esattamente cinque cifre: filtrare qui evita di scoprirlo
            // da una fattura scartata.
            onChange={(e) => set("cap", e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="20100"
            inputMode="numeric"
          />
        </div>
        <div>
          <Label>Comune</Label>
          <Input value={val("comune")} onChange={(e) => set("comune", e.target.value)} placeholder="Milano" maxLength={60} />
        </div>
        <div>
          <Label>Prov.</Label>
          <Input
            value={val("provincia")}
            onChange={(e) => set("provincia", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))}
            placeholder="MI"
          />
        </div>
      </div>
    </div>
  );
}
