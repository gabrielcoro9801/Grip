CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attore_id" uuid,
	"attore_nome" varchar(255) DEFAULT '',
	"ruolo_attore" varchar(32) DEFAULT '',
	"tipo_azione" varchar(64) NOT NULL,
	"entita_tipo" varchar(64) NOT NULL,
	"entita_nome" varchar(255) DEFAULT '',
	"entita_id" varchar(255) DEFAULT '',
	"dettagli" text DEFAULT '',
	"valore_precedente" text DEFAULT '',
	"valore_nuovo" text DEFAULT '',
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(255) DEFAULT 'La mia palestra' NOT NULL,
	"ragione_sociale" varchar(255),
	"piva_cf" varchar(32),
	"indirizzo" text,
	"logo_url" text,
	"regime_fiscale" varchar(64),
	"gestione_iva" boolean,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"tipo" varchar(16) NOT NULL,
	"nome" varchar(255),
	"cognome" varchar(255),
	"ragione_sociale" varchar(255),
	"email" varchar(255),
	"telefono" varchar(64),
	"codice_fiscale_piva" varchar(32),
	"note" text,
	"attivo" boolean DEFAULT true NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"document_type" varchar(64),
	"file_name" varchar(255),
	"file_url" text,
	"expiry_date" date,
	"notes" text,
	"caricato_da" varchar(255),
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(64),
	"date_of_birth" date,
	"address" text,
	"emergency_contact_name" varchar(255),
	"emergency_contact_phone" varchar(64),
	"gdpr_consent" boolean DEFAULT false,
	"gdpr_consent_date" date,
	"codice_socio" varchar(16),
	"notes" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"duration_days" integer NOT NULL,
	"sessions_included" integer DEFAULT 999 NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qr_accessi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"cliente_name" varchar(255),
	"codice" varchar(64) NOT NULL,
	"data_generazione" timestamp with time zone DEFAULT now() NOT NULL,
	"stato" varchar(16) DEFAULT 'attivo' NOT NULL,
	CONSTRAINT "qr_accessi_codice_unique" UNIQUE("codice")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_name" varchar(255),
	"start_date" date NOT NULL,
	"end_date" date,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"sessions_remaining" integer DEFAULT 999,
	"price_paid" numeric(10, 2),
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"member_name" varchar(255),
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"waitlist_position" integer,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(16) DEFAULT '#3b82f6' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"category_id" uuid,
	"instructor_id" uuid,
	"description" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"recurrence_type" varchar(16) NOT NULL,
	"days_of_week" jsonb,
	"start_date" date NOT NULL,
	"end_condition" varchar(16),
	"end_date" date,
	"occurrence_count" integer,
	"custom_dates" jsonb,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instructors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"tax_id" varchar(32),
	"contact_email" varchar(255),
	"contact_phone" varchar(64),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"capacity" integer NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room_id" uuid NOT NULL,
	"capacity" integer NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"modified_manually" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"ragione_sociale" varchar(255) NOT NULL,
	"piva_cf" varchar(32),
	"iban" varchar(34),
	"conto_costo_default_id" uuid,
	"email" varchar(255),
	"telefono" varchar(64),
	"attivo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "causali_operative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"nome_visibile" varchar(255) NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"icona" varchar(32),
	"conto_contropartita_id" uuid,
	"richiede_controparte" boolean DEFAULT false NOT NULL,
	"tipo_controparte" varchar(16),
	"gestisce_iva" boolean DEFAULT false NOT NULL,
	"aliquota_iva_default" numeric(5, 2) DEFAULT '22',
	"permette_a_credito" boolean DEFAULT false NOT NULL,
	"conto_credito_debito_id" uuid,
	"puo_essere_istituzionale" boolean DEFAULT false NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"attivo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"codice" varchar(16) NOT NULL,
	"nome" varchar(255) NOT NULL,
	"tipo_conto" varchar(32),
	"natura" varchar(16),
	"conto_padre_id" uuid,
	"gestisce_iva" boolean DEFAULT false,
	"sistema" boolean DEFAULT false NOT NULL,
	"attivo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(32) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"description" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"nome" varchar(255) NOT NULL,
	"valore_acquisto" numeric(12, 2) NOT NULL,
	"data_acquisto" date NOT NULL,
	"conto_id" uuid,
	"stato" varchar(16) DEFAULT 'in_uso' NOT NULL,
	"data_vendita" date,
	"valore_vendita" numeric(12, 2),
	"acquirente" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"numero_protocollo" integer,
	"data_competenza" date NOT NULL,
	"data_cassa" date,
	"descrizione" text,
	"causale" varchar(255),
	"causale_operativa_id" uuid,
	"tipo_origine" varchar(64),
	"stato" varchar(16) DEFAULT 'bozza' NOT NULL,
	"stato_pagamento" varchar(16),
	"data_scadenza" date,
	"natura_fiscale" varchar(32),
	"journal_entry_saldo_id" uuid,
	"riferimento_documento" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"conto_id" uuid NOT NULL,
	"dare" numeric(12, 2) DEFAULT '0' NOT NULL,
	"avere" numeric(12, 2) DEFAULT '0' NOT NULL,
	"controparte_tipo" varchar(16),
	"controparte_id" uuid,
	"controparte_e_socio" boolean,
	"importo_iva" numeric(12, 2),
	"aliquota_iva" numeric(5, 2),
	"note" text,
	CONSTRAINT "dare_avere_esclusivi" CHECK (("journal_lines"."dare" = 0 AND "journal_lines"."avere" > 0) OR ("journal_lines"."dare" > 0 AND "journal_lines"."avere" = 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"numero_rata" integer NOT NULL,
	"data_scadenza" date NOT NULL,
	"quota_capitale" numeric(12, 2) NOT NULL,
	"quota_interessi" numeric(12, 2) NOT NULL,
	"stato_pagamento" varchar(16) DEFAULT 'da_pagare' NOT NULL,
	"journal_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"ente_finanziatore" varchar(255) NOT NULL,
	"capitale_erogato" numeric(12, 2) NOT NULL,
	"tasso_interesse" numeric(5, 2),
	"data_inizio" date NOT NULL,
	"numero_rate_totali" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid,
	"member_name" varchar(255),
	"plan_name" varchar(255),
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"category" varchar(64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaboratori" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"nome" varchar(255) NOT NULL,
	"cognome" varchar(255) NOT NULL,
	"tipo_rapporto" varchar(32) NOT NULL,
	"ruolo" varchar(255),
	"email" varchar(255),
	"phone" varchar(64),
	"hire_date" date,
	"notes" text,
	"attivo" boolean DEFAULT true NOT NULL,
	"soglia_settimanale_ore" integer DEFAULT 40,
	"giorni_ferie_anno" integer DEFAULT 26,
	"tipo_contratto" varchar(16),
	"importo_fisso" numeric(12, 2),
	"percentuale" numeric(5, 2),
	"importo_seduta" numeric(12, 2),
	"importo_autocertificato_altri_enti" numeric(12, 2),
	"data_autocertificazione" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liquidazioni_pt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collaboratore_id" uuid NOT NULL,
	"collaboratore_nome" varchar(255),
	"periodo_anno" integer NOT NULL,
	"periodo_mese" integer NOT NULL,
	"numero_sedute" integer DEFAULT 0 NOT NULL,
	"importo_totale" numeric(12, 2) NOT NULL,
	"tipo_contratto" varchar(16),
	"stato" varchar(16) DEFAULT 'bozza' NOT NULL,
	"journal_entry_id" uuid,
	"data_liquidazione" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "richieste_ferie_permesso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dipendente_id" uuid NOT NULL,
	"dipendente_nome" varchar(255),
	"tipo" varchar(16) NOT NULL,
	"data_inizio" date NOT NULL,
	"data_fine" date,
	"ore" numeric(6, 2) DEFAULT '0',
	"stato" varchar(16) DEFAULT 'in_attesa' NOT NULL,
	"motivazione" text,
	"approvato_da" varchar(255),
	"approvato_il" timestamp with time zone,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sedute_pt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collaboratore_id" uuid NOT NULL,
	"collaboratore_nome" varchar(255),
	"cliente_id" uuid,
	"cliente_nome" varchar(255),
	"sala_id" uuid,
	"sala_nome" varchar(255),
	"data_ora_inizio" timestamp with time zone NOT NULL,
	"data_ora_fine" timestamp with time zone NOT NULL,
	"importo" numeric(12, 2),
	"note" text,
	"stato" varchar(16) DEFAULT 'prenotata' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"ruolo" varchar(32) NOT NULL,
	"attivo" boolean DEFAULT true NOT NULL,
	"linked_collaboratore_id" uuid,
	"linked_member_id" uuid,
	"last_activity_date" timestamp with time zone,
	CONSTRAINT "staff_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timbrature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dipendente_id" uuid NOT NULL,
	"dipendente_nome" varchar(255),
	"tipo" varchar(16) NOT NULL,
	"data_ora_server" timestamp with time zone DEFAULT now() NOT NULL,
	"corretta_da" varchar(255),
	"corretta_il" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turni" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dipendente_id" uuid NOT NULL,
	"dipendente_nome" varchar(255),
	"data" date NOT NULL,
	"ora_inizio" time NOT NULL,
	"ora_fine" time NOT NULL,
	"sala_id" uuid,
	"sala_nome" varchar(255),
	"note" text,
	"stato" varchar(16) DEFAULT 'assegnato' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercise_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"member_name" varchar(255),
	"name" varchar(255) NOT NULL,
	"notes" text,
	"exercises" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"muscle_group" varchar(32),
	"default_sets" integer DEFAULT 3,
	"default_reps" varchar(16) DEFAULT '10'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workout_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_name" varchar(255),
	"exercise_name" varchar(255),
	"muscle_group" varchar(32),
	"peso_usato" numeric(8, 2),
	"reps_fatte" integer,
	"rpe_percepito" integer,
	"data" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"data_decorrenza" date NOT NULL,
	"forma_giuridica" varchar(64),
	"data_costituzione" date,
	"data_chiusura_esercizio" date,
	"ente_affiliazione" varchar(255),
	"numero_affiliazione" varchar(64),
	"iscritta_rasd" boolean,
	"numero_iscrizione_rasd" varchar(64),
	"iscritta_runts" boolean,
	"qualifica_runts" varchar(64),
	"regime_fiscale" varchar(64),
	"data_comunicazione_siae" date,
	"data_opzione" date,
	"partita_iva_posseduta" boolean,
	"numero_partita_iva" varchar(32),
	"data_apertura_partita_iva" date,
	"note" text,
	"data_inserimento" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_year_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"anno_esercizio" integer,
	"data_inizio_esercizio" date,
	"data_fine_esercizio" date,
	"proventi_commerciali" numeric(12, 2),
	"proventi_complessivi" numeric(12, 2),
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"nota_piede" text,
	"colore_accento" varchar(16) DEFAULT '#1e40af',
	"mostra_iva_override" boolean
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"cliente_id" uuid,
	"cliente_name" varchar(255),
	"member_id" uuid,
	"member_name" varchar(255),
	"subscription_id" uuid,
	"plan_name" varchar(255),
	"journal_entry_id" uuid,
	"numero_progressivo" integer,
	"esercizio_fiscale" integer,
	"tipo_documento" varchar(32),
	"data_emissione" date,
	"importo_lordo" numeric(12, 2),
	"imponibile" numeric(12, 2),
	"iva" numeric(12, 2),
	"aliquota_iva" numeric(5, 2),
	"payment_status" varchar(16),
	"stato" varchar(16) DEFAULT 'bozza' NOT NULL,
	"data_scadenza" date,
	"versione" integer DEFAULT 1 NOT NULL,
	"amount" numeric(12, 2),
	"date" date,
	"pdf_url" text,
	"rigenerata_il" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_documents" ADD CONSTRAINT "member_documents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_cliente_id_clients_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qr_accessi" ADD CONSTRAINT "qr_accessi_cliente_id_members_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_suppliers" ADD CONSTRAINT "accounting_suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_suppliers" ADD CONSTRAINT "accounting_suppliers_conto_costo_default_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_costo_default_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "causali_operative" ADD CONSTRAINT "causali_operative_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "causali_operative" ADD CONSTRAINT "causali_operative_conto_contropartita_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_contropartita_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "causali_operative" ADD CONSTRAINT "causali_operative_conto_credito_debito_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_credito_debito_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_conto_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_causale_operativa_id_causali_operative_id_fk" FOREIGN KEY ("causale_operativa_id") REFERENCES "public"."causali_operative"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_entry_saldo_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_saldo_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_conto_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loans" ADD CONSTRAINT "loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collaboratori" ADD CONSTRAINT "collaboratori_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liquidazioni_pt" ADD CONSTRAINT "liquidazioni_pt_collaboratore_id_collaboratori_id_fk" FOREIGN KEY ("collaboratore_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liquidazioni_pt" ADD CONSTRAINT "liquidazioni_pt_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "richieste_ferie_permesso" ADD CONSTRAINT "richieste_ferie_permesso_dipendente_id_collaboratori_id_fk" FOREIGN KEY ("dipendente_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sedute_pt" ADD CONSTRAINT "sedute_pt_collaboratore_id_collaboratori_id_fk" FOREIGN KEY ("collaboratore_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sedute_pt" ADD CONSTRAINT "sedute_pt_cliente_id_clients_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sedute_pt" ADD CONSTRAINT "sedute_pt_sala_id_rooms_id_fk" FOREIGN KEY ("sala_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_linked_collaboratore_id_collaboratori_id_fk" FOREIGN KEY ("linked_collaboratore_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timbrature" ADD CONSTRAINT "timbrature_dipendente_id_collaboratori_id_fk" FOREIGN KEY ("dipendente_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "turni" ADD CONSTRAINT "turni_dipendente_id_collaboratori_id_fk" FOREIGN KEY ("dipendente_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "turni" ADD CONSTRAINT "turni_sala_id_rooms_id_fk" FOREIGN KEY ("sala_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_plans" ADD CONSTRAINT "exercise_plans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_id_exercise_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."exercise_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_profile_snapshots" ADD CONSTRAINT "fiscal_profile_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_year_data" ADD CONSTRAINT "fiscal_year_data_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipt_templates" ADD CONSTRAINT "receipt_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cliente_id_clients_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
