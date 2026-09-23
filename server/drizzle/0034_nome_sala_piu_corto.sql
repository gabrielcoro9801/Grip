-- Il nome di una sala sta in 50 caratteri: è una riga della tile, accanto al distintivo dello
-- stato, e più lungo di così smette di essere un nome.
--
-- I nomi già più lunghi si accorciano, non si perde la sala. Senza `USING` la conversione
-- fallirebbe sulla prima riga troppo lunga, e la migrazione si fermerebbe lì.
ALTER TABLE "rooms" ALTER COLUMN "name" SET DATA TYPE varchar(50) USING left("name", 50);
