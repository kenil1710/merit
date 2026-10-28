import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Rubric, StoredLimits } from "@/lib/shared/program";

/**
 * Merit data model: the Misthos model ported to Rialo. Money columns are bigint RLO kelvin (9 decimals). Rialo
 * addresses are base58 and case-sensitive, so they are stored exactly as given. On-chain facts (escrow, rounds,
 * ledger entries, payouts) live on Rialo; these tables hold what the chain doesn't (drafts, briefs, every
 * submission including rejected ones, decisions and their records, appeals) plus caches of chain state.
 * `audit_events` is append-only, enforced by a trigger (see drizzle/0001_audit_guard.sql).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const kelvin = (name: string) => bigint(name, { mode: "bigint" });

// ─── Enums ──────────────────────────────────────────────────────────────────

export const programStatus = pgEnum("program_status", ["draft", "active", "paused", "archived"]);
export const memberRole = pgEnum("member_role", ["owner", "reviewer"]);
export const contributorStatus = pgEnum("contributor_status", ["active", "suspended", "removed"]);
/** Mirrors the campaign's on-chain phase for a round (open → settling → settled / waiting for funds). */
export const roundStatus = pgEnum("round_status", ["open", "settling", "waiting_funds", "settled", "failed"]);
export const sourceType = pgEnum("source_type", ["x_post", "github_pr", "github_commit", "article"]);
export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "processing",
  "approved",
  "partial",
  "rejected",
  "escalated",
  "paid",
]);
export const decisionAction = pgEnum("decision_action", ["approve", "partial", "reject", "escalate"]);
export const decidedBy = pgEnum("decided_by", ["agent", "human"]);
export const payoutStatus = pgEnum("payout_status", ["pending", "paid", "skipped", "unfunded"]);
export const noncePurpose = pgEnum("nonce_purpose", ["owner_signin", "wallet_link"]);
/** What happens to X accounts below a program's minimum followers or account age. */
export const belowMinimumPolicy = pgEnum("below_minimum_policy", ["review", "reject", "block"]);

// ─── Identity ───────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  /** Set when the user signs in with their Rialo wallet (owners, reviewers). */
  walletAddress: text("wallet_address").unique(),
  /** Set when the user signs in with X (contributors). */
  xUserId: text("x_user_id").unique(),
  xHandle: text("x_handle"),
  xCreatedAt: timestamp("x_created_at", { withTimezone: true }),
  /** Follower count from the last X sign-in (shown against a program's minimum). */
  xFollowers: integer("x_followers"),
  /** The contributor's payout wallet, proven by a signature over a message naming both. */
  payoutWallet: text("payout_wallet"),
  payoutWalletProofMessage: text("payout_wallet_proof_message"),
  payoutWalletProofSignature: text("payout_wallet_proof_signature"),
  payoutWalletLinkedAt: timestamp("payout_wallet_linked_at", { withTimezone: true }),
  isFounder: boolean("is_founder").notNull().default(false),
  ...timestamps,
});

/** Single-use nonces for owner sign-in and wallet-link signatures. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    purpose: noncePurpose("purpose").notNull(),
    /** The wallet (owner sign-in) or user (wallet link) the nonce was issued to. */
    subject: text("subject").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

// ─── Programs ───────────────────────────────────────────────────────────────

export const programs = pgTable(
  "programs",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    logoUrl: text("logo_url"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** The owner's Rialo wallet: the campaign workflow's payer. */
    ownerWallet: text("owner_wallet").notNull(),
    /** Campaign workflow PDA on Rialo; null while the program is a draft. */
    campaignAddress: text("campaign_address").unique(),
    /** The 32-byte workflow slug (hex) the PDA is derived from; public, grants nothing without the owner's key. */
    campaignSlugHex: text("campaign_slug_hex"),
    /** Agent authority named in the campaign (rotatable on chain with set_agent). */
    agentAddress: text("agent_address"),
    rubricJson: jsonb("rubric_json").$type<Rubric>().notNull(),
    /** RLO kelvin per rubric point; the on-chain rate is maxPoints × ratePerPoint for a score of 100. */
    ratePerPoint: kelvin("rate_per_point").notNull(),
    limitsJson: jsonb("limits_json").$type<StoredLimits>().notNull(),
    autoApproveConfidence: real("auto_approve_confidence").notNull(),
    minScore: integer("min_score").notNull().default(50),
    minAccountAgeDays: integer("min_account_age_days").notNull().default(0),
    minXFollowers: integer("min_x_followers").notNull().default(0),
    belowMinimum: belowMinimumPolicy("below_minimum").notNull().default("review"),
    maxSubmissionsPerRound: integer("max_submissions_per_round").notNull().default(5),
    contextVersion: integer("context_version"),
    roundLengthMinutes: integer("round_length_minutes").notNull(),
    firstRoundStartsAt: timestamp("first_round_starts_at", { withTimezone: true }).notNull(),
    refundDeadlineDays: integer("refund_deadline_days").notNull().default(30),
    /** Planned funding entered in the wizard (the setup checklist sends it on chain). */
    plannedEscrow: kelvin("planned_escrow").notNull().default(sql`0`),
    plannedOpsBudget: kelvin("planned_ops_budget").notNull().default(sql`0`),
    status: programStatus("status").notNull().default("draft"),
    /** Joining paused by the owner (submissions from existing contributors still allowed). */
    joiningPaused: boolean("joining_paused").notNull().default(false),
    /** Demo programs are excluded from every public metric. */
    isDemo: boolean("is_demo").notNull().default(false),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("programs_owner_idx").on(t.ownerUserId)],
);

export interface ContextUnderstanding {
  summary: string;
  keyFacts: string[];
  onTopic: string[];
  offTopic: string[];
}
export interface ContextSource {
  url: string;
  ok: boolean;
  title?: string | null;
  note?: string | null;
}

/** The program's brief for the agent, versioned. Decisions record the version and hash they were judged against. */
export const programContexts = pgTable(
  "program_contexts",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
    version: integer("version"),
    about: text("about").notNull(),
    linksJson: jsonb("links_json").$type<string[]>().notNull().default([]),
    mustIncludeJson: jsonb("must_include_json").$type<string[]>().notNull().default([]),
    status: text("status").$type<"reading" | "ready" | "failed">().notNull().default("ready"),
    understandingJson: jsonb("understanding_json").$type<ContextUnderstanding>(),
    sourcesJson: jsonb("sources_json").$type<ContextSource[]>().notNull().default([]),
    contextHash: text("context_hash"),
    inputHash: text("input_hash").notNull(),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("program_contexts_program_version_uq")
      .on(t.programId, t.version)
      .where(sql`${t.version} is not null`),
    index("program_contexts_input_idx").on(t.inputHash),
  ],
);

export const programMembers = pgTable(
  "program_members",
  {
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.programId, t.userId] }), index("program_members_user_idx").on(t.userId)],
);

export const contributors = pgTable(
  "contributors",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    xUserId: text("x_user_id").notNull(),
    xHandle: text("x_handle").notNull(),
    githubLogin: text("github_login"),
    githubUserId: text("github_user_id"),
    walletAddress: text("wallet_address"),
    walletVerifiedAt: timestamp("wallet_verified_at", { withTimezone: true }),
    walletChangedAt: timestamp("wallet_changed_at", { withTimezone: true }),
    walletProofMessage: text("wallet_proof_message"),
    walletProofSignature: text("wallet_proof_signature"),
    trustTier: integer("trust_tier").notNull().default(0),
    status: contributorStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("contributors_program_x_uq").on(t.programId, t.xUserId),
    // One payout wallet per contributor per program (the program also binds X id ↔ wallet within a round).
    uniqueIndex("contributors_program_wallet_uq").on(t.programId, t.walletAddress),
    index("contributors_user_idx").on(t.userId),
    index("contributors_x_user_idx").on(t.xUserId),
  ],
);

// ─── Rounds, submissions, decisions ─────────────────────────────────────────

export const rounds = pgTable(
  "rounds",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    /** The campaign's on-chain round number. */
    number: integer("number").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: roundStatus("status").notNull().default("open"),
    /** The round's ledger workflow PDA (agent-created), once the first approval opened it. */
    ledgerAddress: text("ledger_address"),
    openLedgerSignature: text("open_ledger_signature"),
    totalPaid: kelvin("total_paid").notNull().default(sql`0`),
    beats: integer("beats").notNull().default(0),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [uniqueIndex("rounds_program_number_uq").on(t.programId, t.number)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    url: text("url").notNull(),
    sourceType: sourceType("source_type").notNull(),
    /** Canonical id: post id, "owner/repo#123", or normalized article URL. */
    resourceId: text("resource_id").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    amount: kelvin("amount"),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Position in the round ledger once approved on chain, and that transaction. */
    ledgerIndex: integer("ledger_index"),
    approveSignature: text("approve_signature"),
    /** The REX report PDA and its verdict ("Verified", "Failed verification", "Inconclusive"). */
    reportAccount: text("report_account"),
    verdict: text("verdict"),
    waitingForFundsAt: timestamp("waiting_for_funds_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("submissions_contributor_resource_live_uq")
      .on(t.contributorId, t.sourceType, t.resourceId)
      .where(sql`status <> 'rejected'`),
    index("submissions_program_resource_idx").on(t.programId, t.sourceType, t.resourceId),
    index("submissions_program_status_idx").on(t.programId, t.status),
    index("submissions_round_idx").on(t.roundId),
    index("submissions_contributor_created_idx").on(t.contributorId, t.createdAt),
  ],
);

export const fetchedResources = pgTable(
  "fetched_resources",
  {
    id: id(),
    sourceType: sourceType("source_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    contentText: text("content_text").notNull(),
    contentHash: text("content_hash").notNull(),
    simhash: bigint("simhash", { mode: "bigint" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("fetched_resources_source_uq").on(t.sourceType, t.resourceId)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    flagsJson: jsonb("flags_json").notNull(),
    llmOutputJson: jsonb("llm_output_json"),
    action: decisionAction("action").notNull(),
    amount: kelvin("amount").notNull().default(sql`0`),
    /** The 0–100 score sent on chain (the program prices it). */
    score: integer("score"),
    categoryKey: text("category_key"),
    points: text("points"),
    summary: text("summary").notNull(),
    /** Canonical JSON that was hashed; its sha256 is the ledger entry's submission_hash for approved items. */
    decisionJson: text("decision_json").notNull(),
    decisionHash: text("decision_hash").notNull().unique(),
    /** ed25519 signature by the agent key over the hash (base58), and the signer. */
    signature: text("signature"),
    signerAddress: text("signer_address"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    ruleVersion: text("rule_version").notNull(),
    decidedBy: decidedBy("decided_by").notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    overrideReason: text("override_reason"),
    /** A re-process or override names the decision it replaces; nothing is rewritten. */
    supersedesId: uuid("supersedes_id"),
    ...timestamps,
  },
  (t) => [index("decisions_submission_idx").on(t.submissionId)],
);

/** Cache of on-chain payouts (the program's settle_pay transactions). */
export const payouts = pgTable(
  "payouts",
  {
    id: id(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    submissionId: uuid("submission_id").references(() => submissions.id),
    toAddress: text("to_address").notNull(),
    amount: kelvin("amount").notNull(),
    decisionHash: text("decision_hash").notNull(),
    signature: text("signature").unique(),
    status: payoutStatus("status").notNull().default("pending"),
    ...timestamps,
  },
  (t) => [index("payouts_contributor_idx").on(t.contributorId), index("payouts_round_idx").on(t.roundId)],
);

// ─── Audit + usage ──────────────────────────────────────────────────────────

/** Append-only. UPDATE/DELETE/TRUNCATE raise an exception at the database level. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    programId: uuid("program_id").references(() => programs.id),
    /** "user:<uuid>", "agent", "chain" or "system". */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    dataJson: jsonb("data_json").notNull().default({}),
    /** The Rialo transaction this event is about, when there is one. */
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_program_created_idx").on(t.programId, t.createdAt)],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: id(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    units: integer("units").notNull().default(1),
    estCostUsd: numeric("est_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    programId: uuid("program_id").references(() => programs.id),
    metaJson: jsonb("meta_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_usage_provider_created_idx").on(t.provider, t.createdAt)],
);

/**
 * Every call Merit makes through a Latch latch, tagged with the X-Merit-Campaign value it sent. Latch's own audit
 * log records method, path and decision but no headers, so this is what groups spend and decisions per campaign.
 * `latchRequestId` is Latch's x-latch-request-id, the key to the same request in the Latch Activity page.
 */
export const latchCalls = pgTable(
  "latch_calls",
  {
    id: id(),
    latch: text("latch").notNull(),
    /** "parent" (merit-judge / merit-x) or "child" (the campaign's own extended latch). */
    via: text("via").notNull().default("parent"),
    campaign: text("campaign").notNull(),
    method: text("method").notNull(),
    /** The upstream path without its query string. */
    path: text("path").notNull(),
    /** HTTP status Merit got back; 0 when Latch couldn't be reached. */
    status: integer("status").notNull(),
    deniedBy: text("denied_by"),
    latchRequestId: text("latch_request_id"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("latch_calls_campaign_created_idx").on(t.campaign, t.createdAt), index("latch_calls_created_idx").on(t.createdAt)],
);

/**
 * A post Merit is about to read through merit-x. merit-x's custom_code filter asks Merit (through the merit-check
 * latch) whether a post id is a pending or recent submission before it lets a read through; an unexpired intent is
 * one of the answers that count, so Merit's own reads of a post it hasn't stored yet go through.
 */
export const latchIntents = pgTable(
  "latch_intents",
  {
    id: id(),
    postId: text("post_id").notNull(),
    campaign: text("campaign").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("latch_intents_post_expires_idx").on(t.postId, t.expiresAt)],
);

/**
 * Each latch's full ordered pipeline as Latch reported it (the per-filter trace of one allowed
 * /latch-self/authorize). Cached because an allowed authorize takes a rate-limit slot, though it never calls upstream.
 */
export const latchSnapshots = pgTable("latch_snapshots", {
  latch: text("latch").primaryKey(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Off-chain records that used to live in a Vercel Blob store (blocked on 2026-10-27 at the Hobby plan's 2,000
 * advanced operations): `judgements` (keyed by post id), `links` (X user id → wallet), `campaigns` (campaign address →
 * name, brief, slug). Values keep the shapes the store always had (lib/server/store.ts).
 */
export const storeRecords = pgTable(
  "store_records",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    valueJson: jsonb("value_json").notNull(),
    /** Where the record came from: "app", or the migration's source ("blob", "seed", "neon:programs", "neon:decisions"). */
    source: text("source").notNull().default("app"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);

/**
 * One DevNet faucet payout through Merit's relay: who got it (wallet), from where (sha256 of the caller's IP, never
 * the IP itself) and when. The relay allows one per wallet per day and a few per IP per day.
 */
export const faucetGrants = pgTable(
  "faucet_grants",
  {
    id: id(),
    wallet: text("wallet").notNull(),
    ipHash: text("ip_hash").notNull(),
    kelvin: kelvin("kelvin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("faucet_grants_wallet_created_idx").on(t.wallet, t.createdAt), index("faucet_grants_ip_created_idx").on(t.ipHash, t.createdAt)],
);

/** "Ask for a second look": one per submission, resolved by the owner's decision. */
export const appeals = pgTable(
  "appeals",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .unique()
      .references(() => submissions.id, { onDelete: "cascade" }),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    decisionHash: text("decision_hash").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionHash: text("resolution_hash"),
    ...timestamps,
  },
  (t) => [index("appeals_program_open_idx").on(t.programId, t.resolvedAt)],
);

/** Fixed-window request counters shared by every server instance (sign-in, submit, "Read it", probes). */
export const rateHits = pgTable(
  "rate_hits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_hits_window_idx").on(t.windowStart)],
);
