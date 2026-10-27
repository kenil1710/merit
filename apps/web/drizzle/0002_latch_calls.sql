CREATE TABLE "latch_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"latch" text NOT NULL,
	"via" text DEFAULT 'parent' NOT NULL,
	"campaign" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"denied_by" text,
	"latch_request_id" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "latch_calls_campaign_created_idx" ON "latch_calls" USING btree ("campaign","created_at");--> statement-breakpoint
CREATE INDEX "latch_calls_created_idx" ON "latch_calls" USING btree ("created_at");