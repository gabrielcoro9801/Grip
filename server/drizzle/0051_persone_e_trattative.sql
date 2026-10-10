-- Lead, soci e ex soci diventano persone: una tabella per chi la palestra conosce, con attorno le
-- trattative (i lead), il diario e i consensi (vedi db/schema/persone.js e lead.js).
--
-- Le tabelle le crea la parte generata qui sotto; la seconda parte, scritta a mano, porta i dati
-- di prima nel modello nuovo. Gli id restano quelli di prima: la persona di un socio ha l'id del
-- socio, la persona e la trattativa di un lead hanno l'id del lead. I link e i riferimenti già
-- dati in giro continuano a funzionare.

CREATE TABLE "trattative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"data_contatto" date NOT NULL,
	"canale_id" uuid NOT NULL,
	"stato" varchar(24) DEFAULT 'nuovo' NOT NULL,
	"stato_dal" date DEFAULT CURRENT_DATE NOT NULL,
	"tentativi_senza_risposta" integer DEFAULT 0 NOT NULL,
	"ultimo_contatto_il" date,
	"ultima_risposta_il" date,
	"richiamare_il" date,
	"motivo_chiusura" varchar(32),
	"assegnata_a_id" uuid,
	"interesse_categoria_id" uuid,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trattative_stato_valido" CHECK ("trattative"."stato" IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare', 'non_raggiungibile', 'non_interessato', 'iscritto'))
);
--> statement-breakpoint
CREATE TABLE "attivita" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"trattativa_id" uuid,
	"tipo" varchar(24) NOT NULL,
	"canale" varchar(16),
	"esito" varchar(32),
	"nota" varchar(500),
	"autore_id" uuid,
	"autore_nome" varchar(255) NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"tipo" varchar(24) NOT NULL,
	"valore" boolean NOT NULL,
	"fonte" varchar(16) NOT NULL,
	"autore_nome" varchar(255) NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consensi_tipo_valido" CHECK ("consensi"."tipo" IN ('marketing_email', 'marketing_sms', 'marketing_push')),
	CONSTRAINT "consensi_fonte_valida" CHECK ("consensi"."fonte" IN ('portale', 'reception', 'form'))
);
--> statement-breakpoint
CREATE TABLE "persone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(120) NOT NULL,
	"cognome" varchar(120),
	"full_name" varchar(255) GENERATED ALWAYS AS (trim(nome || ' ' || coalesce(cognome, ''))) STORED,
	"telefono" varchar(64),
	"email" varchar(255),
	"sesso" varchar(8),
	"anno_nascita" integer,
	"nota" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persone_sesso_valido" CHECK ("persone"."sesso" IS NULL OR "persone"."sesso" IN ('M', 'F', 'altro')),
	CONSTRAINT "persone_anno_nascita_valido" CHECK ("persone"."anno_nascita" IS NULL OR "persone"."anno_nascita" BETWEEN 1900 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "impostazioni" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "persona_id" uuid;--> statement-breakpoint
ALTER TABLE "trattative" ADD CONSTRAINT "trattative_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trattative" ADD CONSTRAINT "trattative_canale_id_canali_contatto_id_fk" FOREIGN KEY ("canale_id") REFERENCES "public"."canali_contatto"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trattative" ADD CONSTRAINT "trattative_assegnata_a_id_staff_accounts_id_fk" FOREIGN KEY ("assegnata_a_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trattative" ADD CONSTRAINT "trattative_interesse_categoria_id_categories_id_fk" FOREIGN KEY ("interesse_categoria_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_trattativa_id_trattative_id_fk" FOREIGN KEY ("trattativa_id") REFERENCES "public"."trattative"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_autore_id_staff_accounts_id_fk" FOREIGN KEY ("autore_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensi" ADD CONSTRAINT "consensi_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trattative_data_contatto_idx" ON "trattative" USING btree ("data_contatto");--> statement-breakpoint
CREATE INDEX "trattative_stato_idx" ON "trattative" USING btree ("stato");--> statement-breakpoint
CREATE INDEX "trattative_persona_id_idx" ON "trattative" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trattative_una_aperta_idx" ON "trattative" USING btree ("persona_id") WHERE "trattative"."stato" IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare');--> statement-breakpoint
CREATE INDEX "attivita_persona_id_idx" ON "attivita" USING btree ("persona_id","created_date");--> statement-breakpoint
CREATE INDEX "attivita_trattativa_id_idx" ON "attivita" USING btree ("trattativa_id");--> statement-breakpoint
CREATE INDEX "consensi_persona_id_idx" ON "consensi" USING btree ("persona_id","created_date");--> statement-breakpoint
CREATE INDEX "persone_telefono_idx" ON "persone" USING btree ("telefono");--> statement-breakpoint
CREATE INDEX "persone_email_idx" ON "persone" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_persona_id_univoco" UNIQUE("persona_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- I dati di prima nel modello nuovo
-- ---------------------------------------------------------------------------------------------

-- I numeri di telefono in formato internazionale: la stessa regola di normalizzaTelefono
-- (shared/anagrafica.js). Un numero che la regola non riconosce resta com'era scritto: lo si
-- corregge alla prossima modifica della scheda, non lo si perde qui.
CREATE FUNCTION "grip_normalizza_telefono"(grezzo text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
	c text;
BEGIN
	grezzo := btrim(coalesce(grezzo, ''));
	IF grezzo = '' OR grezzo ~ '[^0-9\s+()./-]' THEN RETURN NULL; END IF;
	c := regexp_replace(grezzo, '[^0-9+]', '', 'g');
	IF left(c, 2) = '00' THEN c := '+' || substr(c, 3); END IF;
	IF position('+' in substr(c, 2)) > 0 THEN RETURN NULL; END IF;
	IF left(c, 1) = '+' THEN
		RETURN CASE WHEN c ~ '^\+[1-9][0-9]{6,14}$' THEN c END;
	END IF;
	IF c ~ '^(3[0-9]{8,9}|0[0-9]{5,10})$' THEN RETURN '+39' || c; END IF;
	IF c ~ '^39(3[0-9]{8,9}|0[0-9]{5,10})$' THEN RETURN '+' || c; END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint
UPDATE "members" SET
	"phone" = coalesce("grip_normalizza_telefono"("phone"), "phone"),
	"emergency_contact_phone" = coalesce("grip_normalizza_telefono"("emergency_contact_phone"), "emergency_contact_phone");
--> statement-breakpoint
UPDATE "leads" SET "telefono" = coalesce("grip_normalizza_telefono"("telefono"), "telefono");
--> statement-breakpoint
DROP FUNCTION "grip_normalizza_telefono"(text);
--> statement-breakpoint

-- Ogni socio è una persona, con lo stesso id.
INSERT INTO "persone" ("id", "nome", "cognome", "telefono", "email", "sesso", "anno_nascita", "nota", "created_date", "updated_date")
	SELECT "id", "nome", "cognome", "phone", "email", "sesso", extract(year from "date_of_birth")::integer, "notes", "created_date", "updated_date"
	FROM "members";
--> statement-breakpoint
UPDATE "members" SET "persona_id" = "id";
--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "persona_id" SET NOT NULL;
--> statement-breakpoint

-- Ogni lead è una persona con una trattativa, entrambe con l'id del lead; il suo diario passa alla persona.
INSERT INTO "persone" ("id", "nome", "cognome", "telefono", "email", "sesso", "anno_nascita", "nota", "created_date", "updated_date")
	SELECT "id", "nome", "cognome", "telefono", "email", "sesso", "anno_nascita", "note", "created_date", "updated_date"
	FROM "leads";
--> statement-breakpoint
INSERT INTO "trattative" ("id", "persona_id", "data_contatto", "canale_id", "stato", "stato_dal", "tentativi_senza_risposta",
		"ultimo_contatto_il", "ultima_risposta_il", "richiamare_il", "motivo_chiusura", "created_date", "updated_date")
	SELECT "id", "id", "data_contatto", "canale_id", "stato", "stato_dal", "tentativi_senza_risposta",
		"ultimo_contatto_il", "ultima_risposta_il", "richiamare_il", "motivo_chiusura", "created_date", "updated_date"
	FROM "leads";
--> statement-breakpoint
INSERT INTO "attivita" ("id", "persona_id", "trattativa_id", "tipo", "canale", "esito", "nota", "autore_id", "autore_nome", "created_date")
	SELECT "id", "lead_id", "lead_id", "tipo", "canale", "esito", "nota", "autore_id", "autore_nome", "created_date"
	FROM "lead_attivita";
--> statement-breakpoint

-- I soci nati da un contatto: il lead era stato cancellato, il socio ricordava canale e giorno.
-- Diventano la trattativa vinta, iscritta il giorno in cui è nato il socio.
INSERT INTO "trattative" ("persona_id", "data_contatto", "canale_id", "stato", "stato_dal", "created_date", "updated_date")
	SELECT "id", coalesce("lead_data_contatto", ("created_date" AT TIME ZONE 'Europe/Rome')::date), "lead_canale_id",
		'iscritto', ("created_date" AT TIME ZONE 'Europe/Rome')::date, "created_date", "created_date"
	FROM "members" WHERE "lead_canale_id" IS NOT NULL;
--> statement-breakpoint

-- Il consenso marketing unico di prima, se qualcuno l'aveva dato, vale per ogni canale.
INSERT INTO "consensi" ("persona_id", "tipo", "valore", "fonte", "autore_nome", "created_date")
	SELECT m."id", t."tipo", true, 'reception', 'Migrazione', coalesce(m."consenso_marketing_data"::timestamptz, now())
	FROM "members" m CROSS JOIN (VALUES ('marketing_email'), ('marketing_sms'), ('marketing_push')) AS t("tipo")
	WHERE m."consenso_marketing";
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Socio e persona restano allineati
-- ---------------------------------------------------------------------------------------------
--
-- Un socio si crea da più strade — il modulo dei soci, la trasformazione di un lead, gli script —
-- e ognuna dovrebbe ricordarsi di creare anche la persona e di aggiornarla a ogni modifica. Lo fa
-- il database, una volta per tutte: se il socio nasce senza persona gliene crea una, e da lì in
-- poi copia sulla persona nome, recapiti e note del socio. Sulla persona di un socio questi campi
-- non si scrivono da altre parti (routes/lead.js lo rifiuta).
CREATE FUNCTION "socio_su_persona"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."persona_id" IS NULL THEN
		INSERT INTO "persone" ("nome", "cognome", "telefono", "email", "sesso", "anno_nascita", "nota")
			VALUES (NEW."nome", NEW."cognome", NEW."phone", NEW."email", NEW."sesso", extract(year from NEW."date_of_birth")::integer, NEW."notes")
			RETURNING "id" INTO NEW."persona_id";
	ELSE
		UPDATE "persone" SET
			"nome" = NEW."nome", "cognome" = NEW."cognome", "telefono" = NEW."phone", "email" = NEW."email",
			"sesso" = NEW."sesso", "anno_nascita" = extract(year from NEW."date_of_birth")::integer, "nota" = NEW."notes",
			"updated_date" = now()
		WHERE "id" = NEW."persona_id";
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "members_socio_su_persona"
	BEFORE INSERT OR UPDATE OF "nome", "cognome", "phone", "email", "sesso", "date_of_birth", "notes", "persona_id" ON "members"
	FOR EACH ROW EXECUTE FUNCTION "socio_su_persona"();
