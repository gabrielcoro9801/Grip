ALTER TABLE "organizations" ADD COLUMN "partita_iva" varchar(16);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "codice_fiscale" varchar(16);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "regime_fiscale_codice" varchar(4);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_via" varchar(60);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_civico" varchar(8);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_cap" varchar(5);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_comune" varchar(60);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_provincia" varchar(2);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "indirizzo_nazione" varchar(2) DEFAULT 'IT';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "partita_iva" varchar(16);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "codice_fiscale" varchar(16);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_via" varchar(60);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_civico" varchar(8);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_cap" varchar(5);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_comune" varchar(60);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_provincia" varchar(2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "indirizzo_nazione" varchar(2) DEFAULT 'IT';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "codice_destinatario" varchar(7);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pec" varchar(256);