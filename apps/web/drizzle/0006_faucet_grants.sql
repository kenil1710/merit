CREATE TABLE "faucet_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"ip_hash" text NOT NULL,
	"kelvin" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "faucet_grants_wallet_created_idx" ON "faucet_grants" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE INDEX "faucet_grants_ip_created_idx" ON "faucet_grants" USING btree ("ip_hash","created_at");