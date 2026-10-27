// merit-judge's Cedar policy (latch/merit-judge.cedar), checked with the engine Latch uses (cedar-wasm) against a
// schema rebuilt from Latch's documented mapping: principal User::"<x-user header || anonymous>", action
// Action::"<METHOD>", resource Endpoint::"<path>", context { callerIp, host, hasBody }. Cedar can't see the body, so
// the model and max_tokens rules stay in the payload filter.

import { readFileSync } from "node:fs";
import path from "node:path";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { describe, expect, it } from "vitest";

const POLICY = readFileSync(path.resolve(import.meta.dirname, "../../../latch/merit-judge.cedar"), "utf8");
const SCHEMA = `
entity User;
entity Endpoint;
action "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" appliesTo {
  principal: User, resource: Endpoint, context: { callerIp: String, host: String, hasBody: Bool }
};`;

function decide(p: { user?: string; method: string; path: string; hasBody: boolean }) {
  const answer = cedar.isAuthorized({
    principal: { type: "User", id: p.user ?? "anonymous" },
    action: { type: "Action", id: p.method },
    resource: { type: "Endpoint", id: p.path },
    context: { callerIp: "203.0.113.7", host: "onlatch.com", hasBody: p.hasBody },
    schema: SCHEMA,
    validateRequest: true,
    policies: { staticPolicies: POLICY },
    entities: [],
  });
  if (answer.type !== "success") throw new Error(JSON.stringify(answer.errors));
  return answer.response.decision;
}

const CAMPAIGN = "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";

describe("merit-judge Cedar policy", () => {
  it("parses and validates against Latch's schema", () => {
    const answer = cedar.validate({ schema: SCHEMA, policies: { staticPolicies: POLICY }, validationSettings: { mode: "strict" } });
    expect(answer).toMatchObject({ type: "success", validationErrors: [] });
  });

  it("allows Merit's judge call", () => {
    expect(decide({ user: CAMPAIGN, method: "POST", path: "/v1/messages", hasBody: true })).toBe("allow");
    expect(decide({ user: "owner-0b7f3c2e-1d2a-4c1b-9e8f-1234567890ab", method: "POST", path: "/v1/messages", hasBody: true })).toBe("allow");
  });

  it("denies a call that doesn't name its campaign, any other method or path, and an empty body", () => {
    expect(decide({ method: "POST", path: "/v1/messages", hasBody: true })).toBe("deny");
    expect(decide({ user: CAMPAIGN, method: "GET", path: "/v1/messages", hasBody: false })).toBe("deny");
    expect(decide({ user: CAMPAIGN, method: "POST", path: "/v1/messages/batches", hasBody: true })).toBe("deny");
    expect(decide({ user: CAMPAIGN, method: "POST", path: "/v1/complete", hasBody: true })).toBe("deny");
    expect(decide({ user: CAMPAIGN, method: "POST", path: "/v1/messages", hasBody: false })).toBe("deny");
  });
});
