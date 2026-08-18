import { api } from "@/api/client";

/**
 * Registra un'azione nel log di audit.
 * @param {Object} staffUser - utente staff corrente { id, nome }
 * @param {string} tipo_azione - create|update|delete|deactivate|activate|role_change|password_reset
 * @param {string} entita_tipo - finance_expense|finance_revenue|booking|course|member|staff_account
 * @param {string} entita_nome - nome/descrizione dell'entità coinvolta
 * @param {string} entita_id - id dell'entità
 * @param {string} dettagli - dettagli aggiuntivi
 */
export async function logAction(staffUser, tipo_azione, entita_tipo, entita_nome, entita_id, dettagli, valore_precedente, valore_nuovo) {
  if (!staffUser) return;
  try {
    await api.entities.AuditLog.create({
      attore_nome: staffUser.nome,
      attore_id: staffUser.id,
      ruolo_attore: staffUser.ruolo || "",
      tipo_azione,
      entita_tipo,
      entita_nome: entita_nome || "",
      entita_id: entita_id || "",
      dettagli: dettagli || "",
      valore_precedente: valore_precedente || "",
      valore_nuovo: valore_nuovo || "",
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Silent fail — non bloccare l'operazione principale
  }
}