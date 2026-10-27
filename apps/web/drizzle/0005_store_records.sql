CREATE TABLE "store_records" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_records_kind_key_pk" PRIMARY KEY("kind","key")
);
