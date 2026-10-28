CREATE TABLE "campaign_labels" (
	"address" text PRIMARY KEY NOT NULL,
	"is_test" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
