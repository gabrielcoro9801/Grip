ALTER TABLE "courses" ADD COLUMN "tipo_incarico" varchar(16);--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "collaboratore_id" uuid;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "fornitore_id" uuid;