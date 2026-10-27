// Live: one real judgment and one "Read it" through the merit-judge latch (Haiku 5.5, JSON output, no tools).
// Costs about $0.001; skipped without MERIT_JUDGE_LAT.

import { describe, expect, it } from "vitest";
import { readContext } from "@/lib/agent/context";
import { createJudge } from "@/lib/agent/judge";
import { judgeClient } from "@/lib/server/latch";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";

const live = process.env.MERIT_JUDGE_LAT ? describe : describe.skip;
// The live campaign "Rialo in your own words"; live tests are tagged with it like real calls.
const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
// A fresh owner id per run: merit-judge caps each metadata.user_id at 20 calls a day (rate_limit_9).
const OWNER = `owner-${crypto.randomUUID()}`;

live("merit-judge (live)", () => {
  it("returns a valid structured judgment", async () => {
    const judge = createJudge({ clientFor: (c) => judgeClient(c).messages });
    const out = await judge({
      programName: "Rialo Builders",
      generalRules: "",
      categories: EXAMPLE_RUBRIC.categories,
      ratePerPoint: 1_000_000n,
      flags: [],
      contributorHandle: "alice",
      userId: "42",
      campaign: CAMPAIGN,
      brief: { about: "Rialo is a blockchain whose programs schedule their own timers and read the web through REX.", summary: null, keyFacts: ["Programs schedule their own AFTER timers."], onTopic: ["timers", "REX"], offTopic: ["price"], mustInclude: [] },
      resource: {
        sourceType: "x_post",
        resourceId: "1",
        url: "https://x.com/alice/status/1",
        timestamp: new Date().toISOString(),
        text: "On Rialo a program arms its own AFTER timer: when the round ends it closes itself, settles, and pays verified work. No keeper bot, no cron. That's why Merit needs no worker.",
        author: { id: "42", handle: "alice", name: null, createdAt: null, followers: 100 },
        x: { isRepost: false, isReply: false, isQuote: false, likes: 1, reposts: 0, replies: 0, quotes: 0, impressions: 50, lang: "en", urls: [], thread: { postIds: ["1"], truncated: false, note: null } },
      },
    });
    console.log(JSON.stringify({ output: out.output, usage: out.usage, model: out.model }));
    expect(out.output.category).toBe("threads");
    expect(Object.keys(out.output.rubric_scores).sort()).toEqual(["accuracy", "clarity", "depth"]);
  }, 60_000);

  it("drafts an understanding (Read it)", async () => {
    const out = await readContext({ about: "Rialo is a blockchain whose programs schedule their own timers and read the web through REX. We pay builders for threads that explain them.", links: ["@RialoHQ"] }, { fetchPage: async () => null, client: judgeClient(OWNER).messages, userId: OWNER });
    console.log(JSON.stringify(out));
    expect(out.error).toBeNull();
    expect(out.understanding?.summary.length).toBeGreaterThan(10);
  }, 60_000);
});

const liveX = process.env.MERIT_X_LAT ? describe : describe.skip;

liveX("merit-x (live)", () => {
  it("reads round 1's post with its author's age and followers", async () => {
    const { fetchXPost } = await import("@/lib/agent/x");
    const { xGet } = await import("@/lib/server/latch");
    const out = await fetchXPost("2113550979329368489", (p) => xGet(p, CAMPAIGN));
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    console.log(JSON.stringify({ author: out.resource.author, thread: out.resource.x.thread, chars: out.resource.text.length }));
    expect(out.resource.author.id).toBe("1658044857343000579");
    expect(out.resource.author.createdAt).toBeTruthy();
  }, 60_000);
});
