-- Fino a quante ore prima dell'inizio il socio disdice da sé; vuoto = fino alla fine.
ALTER TABLE "courses" ADD COLUMN "disdetta_entro_ore" integer;