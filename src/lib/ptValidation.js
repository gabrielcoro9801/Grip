import moment from "moment";
import { formatOra } from "@/lib/format";

/** Verifica sovrapposizione tra due intervalli (stessa logica dei corsi) */
function timeOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

/**
 * Valida una seduta in fase di creazione/modifica.
 * Controlla sovrapposizione sala-orario e collaboratore-orario.
 * Ritorna un messaggio di errore stringa, o null se valido.
 */
export function validateSedutaForm(form, existingSedute, excludeId) {
  if (!form.collaboratore_id) return "Il collaboratore è obbligatorio.";
  if (!form.cliente_id) return "Il cliente è obbligatorio.";
  if (!form.data_ora_inizio || !form.data_ora_fine) return "Data e ora sono obbligatorie.";
  if (form.data_ora_inizio >= form.data_ora_fine) return "L'orario di inizio deve precedere quello di fine.";

  for (const s of existingSedute) {
    if (excludeId && s.id === excludeId) continue;
    if (s.stato === "annullata") continue;
    if (!timeOverlap(s.data_ora_inizio, s.data_ora_fine, form.data_ora_inizio, form.data_ora_fine)) continue;

    if (s.sala_id && form.sala_id && s.sala_id === form.sala_id) {
      return `Sala già occupata da un'altra seduta (${s.cliente_nome} alle ${formatOra(s.data_ora_inizio)}).`;
    }
    if (s.collaboratore_id === form.collaboratore_id) {
      return `Il collaboratore è già impegnato in un'altra seduta (${s.cliente_nome} alle ${formatOra(s.data_ora_inizio)}).`;
    }
  }
  return null;
}

/**
 * Calcola il compenso periodico per un collaboratore sportivo basato sulle sedute svolte.
 * @param {Object} collaboratore - anagrafica Collaboratore con tipo_contratto, importo_fisso, percentuale, importo_seduta
 * @param {Array} seduteSvolte - sedute con stato "svolta"
 * @param {number} year - anno
 * @param {number} month - mese (0-based)
 */
export function calcCompensoPT(collaboratore, seduteSvolte, year, month) {
  const sedute = seduteSvolte.filter((s) => {
    const d = new Date(s.data_ora_inizio);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  switch (collaboratore?.tipo_contratto) {
    case "fisso":
      return { importo: collaboratore.importo_fisso || 0, numeroSedute: sedute.length };
    case "percentuale": {
      const incasso = sedute.reduce((sum, s) => sum + (s.importo || 0), 0);
      return { importo: (incasso * (collaboratore.percentuale || 0)) / 100, numeroSedute: sedute.length };
    }
    case "a_seduta":
      return { importo: sedute.length * (collaboratore.importo_seduta || 0), numeroSedute: sedute.length };
    default:
      return { importo: 0, numeroSedute: sedute.length };
  }
}

/** Genera CSV per export liquidazioni */
export function generaCSVLiquidazioni(righe) {
  const headers = ["Collaboratore", "Periodo", "Tipo Contratto", "Sedute Svolte", "Importo Totale", "Stato"];
  const lines = [
    headers,
    ...righe.map((r) => [
      r.collaboratore_nome,
      r.periodo,
      r.tipo_contratto,
      r.numero_sedute,
      r.importo_totale.toFixed(2),
      r.stato,
    ]),
  ];
  return lines
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}