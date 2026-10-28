// The community tester's second report (2026-10-28): one set of round labels, live countdowns, the campaign latch
// card's window, the owner's round pill, and wallet management (confirm + strength, backup and import, lock, forget).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { roundStatus, roundLabel, roundBadgeText } = await import("@/lib/shared/round-window");
const { countdownText } = await import("@/lib/when");
const { childWindow } = await import("@/components/guardrails/child-latches");
const { roundPill } = await import("@/lib/server/program-summary");
const wallet = await import("@/lib/client/wallet");

const MIN = 60_000;
const T0 = Date.parse("2026-10-28T08:12:29.412Z");
const clock = (o: Partial<Parameters<typeof roundStatus>[0]> = {}) => ({
  phase: 1n,
  round: 80n,
  roundStartMs: BigInt(T0),
  roundEndMs: BigInt(T0 + 30 * MIN),
  roundLengthMs: BigInt(30 * MIN),
  submitGraceMs: BigInt(5 * MIN),
  ...o,
});

describe("one round status, one set of labels", () => {
  it("every state maps to Open, Grace period, Settling or Closed (plus Paused and Not started)", () => {
    expect(roundLabel("open")).toBe("Open");
    expect(roundLabel("grace")).toBe("Grace period");
    for (const s of ["settling", "waiting_funds", "awaiting_owner"] as const) expect(roundLabel(s)).toBe("Settling");
    expect(roundLabel("closed")).toBe("Closed");
    expect(roundLabel("ended")).toBe("Closed");
    expect(roundBadgeText("waiting_funds")).toBe("Settling · waiting for funds");
    expect(roundBadgeText("awaiting_owner", true)).toBe("Settling · needs your approval");
  });

  it("a round's text starts with its number and its label, whichever page shows it", () => {
    const at = (phase: bigint, minutes: number) => roundStatus(clock({ phase }), T0 + minutes * MIN);
    expect(at(1n, 10).text).toMatch(/^Round 80 · Open /);
    expect(at(2n, 31).text).toMatch(/^Round 80 · Grace period /);
    expect(at(2n, 36).text).toMatch(/^Round 80 · Settling/);
    expect(at(3n, 36).text).toMatch(/^Round 80 · Settling: waiting for the owner to add funds/);
    // No page may still say the old words.
    for (const m of [10, 31, 36, 60]) expect(at(2n, m).text).not.toMatch(/pays out next|late work taken|closing/i);
  });

  it("the countdown targets the next thing due: close, end of grace, next round", () => {
    expect(roundStatus(clock(), T0 + 10 * MIN).countdown?.to.getTime()).toBe(T0 + 30 * MIN);
    expect(roundStatus(clock({ phase: 2n }), T0 + 31 * MIN).countdown?.to.getTime()).toBe(T0 + 35 * MIN);
    expect(roundStatus(clock({ phase: 2n }), T0 + 36 * MIN).countdown?.prefix).toBe("next round in");
    expect(roundStatus(clock({ phase: 6n }), T0 + 36 * MIN).countdown).toBeNull();
  });
});

describe("live countdowns", () => {
  it("count to the second under a day", () => {
    expect(countdownText(3 * MIN)).toBe("3m 00s");
    expect(countdownText(3 * MIN - 1000)).toBe("2m 59s");
    expect(countdownText(65 * MIN + 9000)).toBe("1h 05m 09s");
    expect(countdownText(12_000)).toBe("12s");
    expect(countdownText(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
    expect(countdownText(0)).toBe("now");
  });

  it("the owner's round pill uses the same labels and carries a countdown, not a frozen 'closes in 3m'", () => {
    const program = { firstRoundStartsAt: new Date(T0 + 60 * MIN) } as never;
    const open = roundPill(clock() as never, program, T0 + 10 * MIN)!;
    expect(open).toMatchObject({ text: "Round 80 · Open", tone: "live", countdown: { toMs: T0 + 30 * MIN, prefix: "closes in" } });
    expect(roundPill(clock({ phase: 2n }) as never, program, T0 + 31 * MIN)).toMatchObject({ text: "Round 80 · Grace period", tone: "wait" });
    expect(roundPill(clock({ phase: 6n }) as never, program, T0)).toMatchObject({ text: "Round 80 · Settling · needs your approval" });
    expect(roundPill(clock({ phase: 0n, round: 0n }) as never, program, T0)).toMatchObject({ label: "Not started", countdown: { prefix: "opens in" } });
  });
});

describe("Guardrails: a campaign latch's card counts and lists one source over one window", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const e = (iso: string, decision = "allow") => ({ method: "GET", path: "/2/tweets/1", decision, timestamp: iso });

  it("counts exactly the audit entries it lists, inside the last 7 days", () => {
    const audit = [e("2026-10-28T11:00:00Z"), e("2026-10-27T10:00:00Z", "deny"), e("2026-10-25T10:00:00Z"), e("2026-10-24T10:00:00Z"), e("2026-10-23T10:00:00Z"), e("2026-10-10T10:00:00Z")];
    const w = childWindow(audit, now);
    expect(w).toMatchObject({ total: 5, allowed: 4, denied: 1, complete: true });
    expect(w.entries).toHaveLength(5);
    expect(w.entries[0]!.timestamp).toBe("2026-10-28T11:00:00Z");
  });

  it("says when the count is a lower bound (Latch returned only entries inside the window)", () => {
    const w = childWindow([e("2026-10-28T11:00:00Z"), e("2026-10-27T11:00:00Z")], now);
    expect(w).toMatchObject({ total: 2, complete: false });
    expect(childWindow([], now)).toMatchObject({ total: 0, complete: true });
  });
});

describe("wallet passphrase: confirm and strength", () => {
  it("rates length first, then mixed characters; common choices are weak", () => {
    expect(wallet.passphraseStrength("short").label).toBe("Too short");
    expect(wallet.passphraseStrength("abcdefgh").label).toBe("Weak");
    expect(wallet.passphraseStrength("password123!").label).toBe("Weak");
    expect(wallet.passphraseStrength("abcdefghijkl").score).toBe(2);
    expect(wallet.passphraseStrength("Abcdefghij12").score).toBe(3);
    expect(wallet.passphraseStrength("correct horse battery staple").label).toBe("Good");
    expect(wallet.passphraseStrength("Correct horse battery 9!").label).toBe("Strong");
  });

  it("a new passphrase needs 8+ characters and a matching confirmation", () => {
    expect(wallet.newPassphraseError("short", "short")).toMatch(/at least 8/);
    expect(wallet.newPassphraseError("long enough", "long enougj")).toMatch(/don't match/);
    expect(wallet.newPassphraseError("long enough", "long enough")).toBeNull();
  });
});

describe("wallet backup, import, lock and forget (in a browser-like global)", () => {
  let store: Map<string, string>;
  let events: string[];
  const fetchMock = vi.fn(async () => new Response("{}"));

  beforeEach(() => {
    store = new Map();
    events = [];
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      dispatchEvent: (ev: Event) => events.push(ev.type),
    });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => {
    wallet.setUnlocked(null);
    vi.unstubAllGlobals();
  });

  it("creating needs the confirmation to match, and leaves the key unlocked in memory only", async () => {
    await expect(wallet.createWallet("a long passphrase", "a long passphrasf")).rejects.toThrow(/don't match/);
    const k = await wallet.createWallet("a long passphrase", "a long passphrase");
    expect(wallet.getUnlocked()?.publicKey.toString()).toBe(k.publicKey.toString());
    expect([...store.values()].join()).not.toContain(Buffer.from(k.secretKeyBytes()).toString("base64"));
  });

  it("Lock clears the in-memory key and ends the owner's signed session", async () => {
    await wallet.createWallet("a long passphrase");
    expect(wallet.getUnlocked()).not.toBeNull();
    await wallet.lockWallet();
    expect(wallet.getUnlocked()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/owner/logout", { method: "POST" });
    // What a reload finds: the encrypted vault, no key. Only the passphrase opens it again.
    expect(wallet.savedAddress()).not.toBeNull();
    await expect(wallet.unlockWallet("wrong passphrase")).rejects.toThrow("Wrong passphrase.");
    expect((await wallet.unlockWallet("a long passphrase")).publicKey.toString()).toBe(wallet.savedAddress());
  });

  it("an encrypted backup restores the same wallet after Forget, and only with its passphrase", async () => {
    const k = await wallet.createWallet("a long passphrase");
    const file = wallet.backupFile()!;
    expect(file.name).toBe(`merit-wallet-${k.publicKey.toString().slice(0, 8)}.json`);
    expect(JSON.parse(file.json)).toMatchObject({ format: "merit-wallet-backup", version: 1, kdf: "PBKDF2-SHA256", cipher: "AES-GCM", address: k.publicKey.toString() });

    wallet.forgetWallet();
    expect(wallet.savedAddress()).toBeNull();
    expect(wallet.getUnlocked()).toBeNull();

    await expect(wallet.importBackup(file.json, "not the passphrase")).rejects.toThrow("Wrong passphrase.");
    expect(wallet.savedAddress()).toBeNull();
    const back = await wallet.importBackup(file.json, "a long passphrase");
    expect(back.publicKey.toString()).toBe(k.publicKey.toString());
    expect(wallet.savedAddress()).toBe(k.publicKey.toString());
  });

  it("import refuses other files, and never replaces a different stored wallet", async () => {
    expect(() => wallet.parseBackup("not json")).toThrow(/not JSON/);
    expect(() => wallet.parseBackup(JSON.stringify({ format: "other" }))).toThrow(/isn't a Merit wallet backup/);
    expect(() => wallet.parseBackup(JSON.stringify({ format: "merit-wallet-backup", version: 1, address: "x" }))).toThrow(/incomplete/);
    await wallet.createWallet("first wallet pass");
    const first = wallet.backupFile()!.json;
    wallet.forgetWallet();
    await wallet.createWallet("second wallet pass");
    await expect(wallet.importBackup(first, "first wallet pass")).rejects.toThrow(/Forget it first/);
  });
});
