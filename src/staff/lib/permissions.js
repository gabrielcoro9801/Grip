// I ruoli e la matrice dei permessi vivono in shared/permissions.js perché servono
// identici a interfaccia e server: se il server usasse una copia propria, le due
// potrebbero divergere e il controllo lato server smetterebbe di corrispondere a ciò
// che l'interfaccia mostra.
// Questo file resta come punto di import per il codice dell'applicazione (`@/staff/lib/permissions`).
export * from '../../../shared/permissions.js';
