-- Una password scelta da qualcun altro va cambiata al primo accesso.
--
-- La reimposta un amministratore, la genera la reception per il portale, la legge il primo
-- avvio da una variabile: in tutti questi casi c'è qualcuno oltre al titolare che la conosce.
-- Finché questa colonna è vera, l'API risponde solo al cambio password. Gli account che
-- esistono già partono da falso: nessuno viene bloccato dal rilascio.
ALTER TABLE "staff_accounts" ADD COLUMN "password_da_cambiare" boolean DEFAULT false NOT NULL;
