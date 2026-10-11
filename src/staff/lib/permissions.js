// I ruoli e la matrice dei permessi vivono in shared/permissions.js perché servono
// identici a interfaccia e server: se il server usasse una copia propria, le due
// potrebbero divergere e il controllo lato server smetterebbe di corrispondere a ciò
// che l'interfaccia mostra.
// Questo file resta come punto di import per il codice dell'applicazione (`@/staff/lib/permissions`).
export * from '../../../shared/permissions.js';
import { canAccess } from '../../../shared/permissions.js';

/**
 * Chi del gestionale ha solo le sue lezioni (l'istruttore, di base): la sua pagina iniziale è
 * "Le mie lezioni", non la dashboard. Non è un permesso in più o in meno — la dashboard gli
 * mostrava solo un conteggio e le lezioni di tutti — è dove si atterra.
 */
export const soloLeSueLezioni = (ruolo) => canAccess(ruolo, 'lezioni_istruttore', 'view')
  && !canAccess(ruolo, 'crm_members', 'view') && !canAccess(ruolo, 'crm_leads', 'view');
