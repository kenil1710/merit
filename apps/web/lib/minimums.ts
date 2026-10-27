/**
 * A program's minimum X followers and account age, against one contributor's X account: what they have, what the
 * program asks for, and what happens to their posts. Pure, so the join page, the contributor page, the join route
 * and the submit route all say the same thing (Misthos' rules, unchanged).
 */

export type BelowMinimum = "review" | "reject" | "block";

export interface MinimumRules {
  minXFollowers: number;
  minAccountAgeDays: number;
  belowMinimum: BelowMinimum;
}

export interface MinimumStatus {
  applies: boolean;
  followers: { have: number | null; need: number; ok: boolean | null } | null;
  age: { days: number | null; need: number; ok: boolean | null } | null;
  /** Below at least one minimum (unknown counts are never "below"). */
  below: boolean;
  outcome: "ok" | BelowMinimum;
  text: string;
}

const DAY_MS = 86_400_000;
const n = (x: number) => x.toLocaleString("en");

export function minimumStatus(
  rules: MinimumRules,
  account: { followers: number | null; createdAt: Date | null },
  now: Date = new Date(),
  /** Already a member (joined before "Can't join" was chosen): their posts are rejected instead. */
  member = false,
): MinimumStatus {
  const followers =
    rules.minXFollowers > 0
      ? { have: account.followers, need: rules.minXFollowers, ok: account.followers === null ? null : account.followers >= rules.minXFollowers }
      : null;
  const days = account.createdAt ? Math.floor((now.getTime() - account.createdAt.getTime()) / DAY_MS) : null;
  const age = rules.minAccountAgeDays > 0 ? { days, need: rules.minAccountAgeDays, ok: days === null ? null : days >= rules.minAccountAgeDays } : null;
  const below = followers?.ok === false || age?.ok === false;
  const outcome = below ? rules.belowMinimum : "ok";
  const misses = [
    followers?.ok === false ? `${n(followers.have!)} followers (this program asks for ${n(followers.need)})` : null,
    age?.ok === false ? `an account ${age.days} days old (this program asks for ${age.need})` : null,
  ].filter(Boolean);
  const text =
    !followers && !age
      ? "This program has no minimum followers or account age."
      : !below
        ? "Your X account meets this program's minimums."
        : `You have ${misses.join(" and ")}. ${
            outcome === "review"
              ? "You can join and post; the team reviews your work before it's paid."
              : member
                ? "Everything you submit from this account is rejected automatically."
                : outcome === "reject"
                  ? "You can join, but everything you submit is rejected automatically."
                  : "You can't join with this account."
          }`;
  return { applies: !!followers || !!age, followers, age, below, outcome, text };
}

/** The rule as contributors read it on the join page, before signing in. */
export function minimumRuleText(rules: MinimumRules): string | null {
  const parts = [
    rules.minXFollowers > 0 ? `fewer than ${n(rules.minXFollowers)} followers` : null,
    rules.minAccountAgeDays > 0 ? `younger than ${rules.minAccountAgeDays} days` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const who = `X accounts with ${parts.join(" or ")}`.replace("with younger", "younger");
  const from = `Submissions from ${who}`;
  return rules.belowMinimum === "review"
    ? `${from} are reviewed by the team before payment.`
    : rules.belowMinimum === "reject"
      ? `${from} are rejected automatically.`
      : `${who} can't join.`;
}
