-- Via la capienza della sala. Quanta gente entra a lezione lo decide l'evento, che nella stessa
-- stanza cambia da corso a corso: la capienza della sala serviva solo come valore di partenza
-- del modulo, e due numeri per la stessa cosa erano un numero di troppo.
ALTER TABLE "rooms" DROP COLUMN IF EXISTS "capacity";
