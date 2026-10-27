// Owner sign-in by Rialo wallet signature, through the real route handlers on an in-memory Postgres.

import { Keypair } from "@rialo/ts-cdk";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerSignInMessage, parseOwnerSignIn } from "@/lib/merit/messages";
import { verifyOwnerSignIn } from "@/lib/server/owner-auth";
import { CookieJar, ORIGIN, request } from "./support/routes";

const jar = vi.hoisted(() => ({ current: null as unknown as CookieJar }));
vi.mock("next/headers", () => ({ cookies: async () => jar.current }));
vi.stubEnv("MERIT_DB", "pglite");
vi.stubEnv("MERIT_SESSION_SECRET", "test-session-secret-at-least-32-characters");

const nonceRoute = await import("@/app/api/auth/owner/nonce/route");
const verifyRoute = await import("@/app/api/auth/owner/verify/route");
const sessionRoute = await import("@/app/api/auth/owner/session/route");
const logoutRoute = await import("@/app/api/auth/owner/logout/route");

const sign = (k: Keypair, message: string) => base58.encode(k.sign(new TextEncoder().encode(message)).toBytes());

async function signIn(k: Keypair, edit: (m: ReturnType<typeof base>) => ReturnType<typeof base> = (m) => m) {
  const res = await nonceRoute.POST(request("/api/auth/owner/nonce", { body: { address: k.publicKey.toString() } }));
  const { nonce, domain, uri } = (await res.json()) as { nonce: string; domain: string; uri: string };
  const message = ownerSignInMessage(edit({ ...base(k), nonce, domain, uri }));
  return { message, signature: sign(k, message) };
}
const base = (k: Keypair) => ({ domain: "", uri: "", address: k.publicKey.toString(), network: "rialo:devnet", nonce: "", issuedAt: new Date().toISOString() });
const verify = (body: unknown) => verifyRoute.POST(request("/api/auth/owner/verify", { body }));

beforeEach(() => {
  jar.current = new CookieJar();
});

describe("owner sign-in message", () => {
  it("round-trips and rejects anything else", () => {
    const m = { domain: "merit.test", address: Keypair.generate().publicKey.toString(), uri: ORIGIN, network: "rialo:devnet", nonce: "a".repeat(32), issuedAt: "2026-10-26T10:00:00.000Z" };
    const text = ownerSignInMessage(m);
    expect(parseOwnerSignIn(text)).toEqual(m);
    expect(parseOwnerSignIn(`${text}\nResources: x`)).toBeNull();
    expect(parseOwnerSignIn(text.replace("costs nothing", "costs a lot"))).toBeNull();
  });

  it("checks domain, URI, network and age before the signature, and the nonce last", async () => {
    const k = Keypair.generate();
    const now = new Date("2026-10-26T10:00:00Z");
    const ok = { domain: "merit.test", address: k.publicKey.toString(), uri: ORIGIN, network: "rialo:devnet", nonce: "b".repeat(32), issuedAt: now.toISOString() };
    const consume = vi.fn(async () => true);
    const run = (m: typeof ok, signature?: string) => {
      const message = ownerSignInMessage(m);
      return verifyOwnerSignIn({ message, signature: signature ?? sign(k, message), expectedOrigin: ORIGIN, consumeNonce: consume, now });
    };
    expect(await run({ ...ok, domain: "evil.test" })).toEqual({ ok: false, error: "wrong_domain" });
    expect(await run({ ...ok, uri: "http://evil.test/" })).toEqual({ ok: false, error: "wrong_uri" });
    expect(await run({ ...ok, network: "rialo:mainnet" })).toEqual({ ok: false, error: "wrong_network" });
    expect(await run({ ...ok, issuedAt: new Date(now.getTime() - 11 * 60_000).toISOString() })).toEqual({ ok: false, error: "stale" });
    expect(await run({ ...ok, issuedAt: new Date(now.getTime() + 5 * 60_000).toISOString() })).toEqual({ ok: false, error: "stale" });
    expect(await run(ok, sign(Keypair.generate(), ownerSignInMessage(ok)))).toEqual({ ok: false, error: "bad_signature" });
    expect(consume).not.toHaveBeenCalled();
    expect(await run(ok)).toEqual({ ok: true, address: ok.address });
    expect(consume).toHaveBeenCalledWith(ok.nonce, ok.address);
  });
});

describe("owner sign-in routes", () => {
  it("signs in, reports the session, and signs out", async () => {
    const k = Keypair.generate();
    const res = await verify(await signIn(k));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, address: k.publicKey.toString() });
    expect(jar.current.get("merit_owner")).toBeDefined();
    expect(await (await sessionRoute.GET()).json()).toEqual({ address: k.publicKey.toString() });
    await logoutRoute.POST(request("/api/auth/owner/logout", { body: {} }));
    expect(await (await sessionRoute.GET()).json()).toEqual({ address: null });
  });

  it("refuses a replayed nonce", async () => {
    const k = Keypair.generate();
    const body = await signIn(k);
    expect((await verify(body)).status).toBe(200);
    const replay = await verify(body);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "nonce_used" });
  });

  it("refuses a nonce issued to another wallet", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const { message } = await signIn(a);
    const stolen = ownerSignInMessage({ ...parseOwnerSignIn(message)!, address: b.publicKey.toString() });
    const res = await verify({ message: stolen, signature: sign(b, stolen) });
    expect(await res.json()).toEqual({ error: "nonce_used" });
    expect(jar.current.get("merit_owner")).toBeUndefined();
  });

  it("refuses a message signed for another site", async () => {
    const k = Keypair.generate();
    const res = await verify(await signIn(k, (m) => ({ ...m, domain: "phish.test", uri: "http://phish.test" })));
    expect(await res.json()).toEqual({ error: "wrong_domain" });
  });

  it("refuses cross-origin calls and non-addresses", async () => {
    expect((await nonceRoute.POST(request("/api/auth/owner/nonce", { body: { address: "x" }, origin: "http://evil.test" }))).status).toBe(403);
    expect((await nonceRoute.POST(request("/api/auth/owner/nonce", { body: { address: "not-an-address" } }))).status).toBe(400);
    expect((await verify({ message: "hi", signature: "nope" })).status).toBe(400);
  });

  it("rejects a forged session cookie", async () => {
    jar.current.set("merit_owner", `${Buffer.from(JSON.stringify({ sub: "x", addr: "y", exp: Date.now() + 1e6 })).toString("base64url")}.forged`);
    expect(await (await sessionRoute.GET()).json()).toEqual({ address: null });
  });
});
