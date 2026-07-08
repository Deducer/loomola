CREATE TABLE "note_templates" (
	"owner_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'Custom' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"meeting_context" text NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_templates_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
