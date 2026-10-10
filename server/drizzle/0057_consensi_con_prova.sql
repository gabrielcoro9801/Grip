ALTER TABLE "member_documents" DROP CONSTRAINT "member_documents_tipo_valido";--> statement-breakpoint
ALTER TABLE "consensi" ADD COLUMN "documento_id" uuid;--> statement-breakpoint
ALTER TABLE "consensi" ADD COLUMN "nota" varchar(500);--> statement-breakpoint
ALTER TABLE "member_documents" ADD CONSTRAINT "member_documents_tipo_valido" CHECK ("member_documents"."document_type" IN ('certificato_medico', 'documento_identita', 'consenso_genitori', 'consenso_marketing', 'altro'));