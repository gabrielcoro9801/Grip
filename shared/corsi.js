// Le regole dei corsi che servono sia al server sia alle schermate.

/** Le note di un corso stanno in tre righe della sua tile nel catalogo. */
export const NOTE_CORSO_MASSIMO = 140;

/**
 * Come si ripete un evento: una data sola, o una regola settimanale.
 *
 * Le date personalizzate non si creano più. Gli eventi fatti così prima restano validi e si
 * modificano, ma un evento nuovo è l'uno o l'altro.
 */
export const RICORRENZE_CREABILI = ['single', 'weekly'];
