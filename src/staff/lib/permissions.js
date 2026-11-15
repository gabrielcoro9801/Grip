// I ruoli e la matrice dei permessi vivono in shared/permissions.js perché servono identici a
// interfaccia e server. Questo file resta come punto di import per il codice dell'applicazione
// (`@/staff/lib/permissions`).
export * from '../../../shared/permissions.js';
