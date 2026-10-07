-- Il consenso dei genitori: un tipo di documento a sé, atteso per i soci minorenni.
ALTER TABLE "member_documents" DROP CONSTRAINT "member_documents_tipo_valido";--> statement-breakpoint
ALTER TABLE "member_documents" ADD CONSTRAINT "member_documents_tipo_valido" CHECK ("member_documents"."document_type" IN ('certificato_medico', 'documento_identita', 'consenso_genitori', 'altro'));