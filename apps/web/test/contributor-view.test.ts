// The contributor page's score and round labels: a rejected post shows the score the judge gave (and the minimum it
// missed), and a round that closed says so instead of "waiting".

import { describe, expect, it } from "vitest";
import { roundState, shownScore } from "@/lib/server/contributor-view";
import { EXAMPLE_RUBRIC } from "@/lib/shared/program";

const program = { rubricJson: EXAMPLE_RUBRIC }; // one category, "threads", max 10 points
const decision = (o: Partial<{ score: number | null; action: string; points: string | null; categoryKey: string | null }>) => ({ score: 0, action: "reject", points: "3.66", categoryKey: "threads", ...o });

describe("shownScore", () => {
  it("recovers the real score of a reject saved as 0 (records before the engine fix)", () => {
    expect(shownScore(decision({}), program)).toBe(36);
  });
  it("keeps a stored score, and 0 when there is nothing to recover", () => {
    expect(shownScore(decision({ score: 40 }), program)).toBe(40);
    expect(shownScore(decision({ action: "approve", score: 63, points: "6.30" }), program)).toBe(63);
    expect(shownScore(decision({ points: null }), program)).toBe(0); // a hard-flag reject: the judge never scored it
    expect(shownScore(decision({ categoryKey: "unknown" }), program)).toBe(0);
    expect(shownScore(null, program)).toBeNull();
  });
});

describe("roundState", () => {
  it("open, closing (grace or settling), closed", () => {
    expect(roundState(29, 29, 29)).toBe("open");
    expect(roundState(29, null, 29)).toBe("closing"); // ended, in its grace or settling: can still pay
    expect(roundState(27, 29, 29)).toBe("closed");
    expect(roundState(3, 29, 29)).toBe("closed");
    expect(roundState(3, null, null)).toBe("closed"); // chain unreachable: past rounds read as closed, never "waiting"
  });
});
