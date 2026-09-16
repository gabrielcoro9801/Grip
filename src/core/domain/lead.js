// Le regole dei lead vivono in `shared/`, come quelle delle schede: il server le usa per
// decidere se un passaggio di stato è lecito, le pagine per mostrare solo i pulsanti che il
// server accetterà. Questo file è la porta d'ingresso per il frontend.
export * from '../../../shared/lead.js';
