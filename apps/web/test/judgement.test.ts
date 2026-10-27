import { describe, expect, it } from "vitest";
import seed from "../data/judgements/2113550979329368489.json";
import { hashCanonical, pythonJson, verifyJudgement, type JudgeRecord } from "@/lib/merit/judgement";

describe("judge record hashing", () => {
  it("reproduces Python's sort_keys JSON for round 1, and its on-chain hash", () => {
    const record = JSON.parse(seed.canonical) as JudgeRecord;
    expect(pythonJson(record)).toBe(seed.canonical);
    expect(hashCanonical(seed.canonical)).toBe("fTzfxvv2a2TjbEFRfaDSKK8i8QrzCtvm3ispnZuhfZb");
    expect(verifyJudgement(seed, "fTzfxvv2a2TjbEFRfaDSKK8i8QrzCtvm3ispnZuhfZb").matches).toBe(true);
  });
  it("detects edited reasons", () => {
    const tampered = { ...seed, canonical: seed.canonical.replace("58", "98") };
    expect(verifyJudgement(tampered, seed.submissionHash).matches).toBe(false);
  });
  it("escapes like ensure_ascii", () => {
    expect(pythonJson({ b: ["é", "😀", 'q"'], a: 1 })).toBe('{"a": 1, "b": ["\\u00e9", "\\ud83d\\ude00", "q\\""]}');
  });
});
