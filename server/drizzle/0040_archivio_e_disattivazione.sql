-- Un socio che lascia la palestra si archivia invece di restare fra quelli che frequentano;
-- istruttori e corsi che hanno uno storico si disattivano invece di eliminarsi.
--
-- Tutti nascono non archiviati e attivi: nessun dato esistente cambia significato.
ALTER TABLE "members" ADD COLUMN "archiviato_il" date;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "attivo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "attivo" boolean DEFAULT true NOT NULL;