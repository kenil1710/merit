CREATE TABLE "latch_snapshots" (
	"latch" text PRIMARY KEY NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
