/**
 * Validazione strutturale Session ↔ Event.
 *
 * Invariante: se una Session ha modified_manually = false, i campi
 * start_time, end_time, room_id, capacity devono corrispondere esattamente
 * a quelli dell'Event genitore. Se un'operazione tenta di scrivere valori
 * diversi senza impostare contestualmente modified_manually = true,
 * la scrittura viene bloccata con un errore esplicito.
 *
 * Questa barriera si applica a QUALUNQUE creazione o modifica di Session,
 * non solo durante la generazione iniziale.
 */

const VALIDATED_FIELDS = ["start_time", "end_time", "room_id", "capacity"];

/**
 * Valida una scrittura (create o update) di una Session.
 *
 * @param {Object} writeData - i dati da scrivere sulla sessione
 * @param {Object} event - l'Event genitore
 * @param {Object|null} currentSession - la sessione attuale (per update; null per create)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSessionWrite(writeData, event, currentSession = null) {
  if (!event) {
    return { valid: false, errors: ["Event genitore non trovato."] };
  }

  // Determina il valore effettivo di modified_manually dopo la scrittura
  const effectiveModifiedManually =
    writeData.modified_manually !== undefined
      ? writeData.modified_manually
      : currentSession?.modified_manually ?? false;

  // Se modified_manually è true, l'eccezione è esplicita — sempre valido
  if (effectiveModifiedManually === true) {
    return { valid: true, errors: [] };
  }

  // modified_manually è false: i campi scritti devono corrispondere all'Event
  const errors = [];
  for (const field of VALIDATED_FIELDS) {
    if (writeData[field] !== undefined && writeData[field] !== event[field]) {
      errors.push(`${field}: atteso "${event[field]}", trovato "${writeData[field]}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida un array di record Session per bulkCreate.
 * Tutti devono avere campi identici all'Event (modified_manually = false durante generazione).
 */
export function validateSessionsBulk(records, event) {
  if (!event) {
    return { valid: false, errors: ["Event genitore non trovato."] };
  }
  const allErrors = [];
  for (const record of records) {
    const { valid, errors } = validateSessionWrite(record, event);
    if (!valid) {
      allErrors.push(`${record.date || "N/D"}: ${errors.join(", ")}`);
    }
  }
  return { valid: allErrors.length === 0, errors: allErrors };
}