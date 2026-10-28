import "server-only";

// Signed, HttpOnly cookies. A contributor session holds only the X account id
// and handle proven by OAuth; no X access token is ever stored. An owner
// session holds the user id and the Rialo wallet that signed in.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export type Session = { xUserId: string; username: string; exp: number };
export type OwnerSession = { sub: string; addr: string; exp: number };
export type OAuthState = { state: string; verifier: string; returnTo: string; exp: number };

const SESSION = "merit_session";
const OAUTH = "merit_oauth";
const OWNER = "merit_owner";

// Each cookie's payload names its type, so a valid token for one cookie never passes as another.
type Typ = "contributor" | "owner" | "oauth";

function sign(typ: Typ, payload: object): string {
  const body = Buffer.from(JSON.stringify({ ...payload, typ })).toString("base64url");
  const mac = createHmac("sha256", env.sessionSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign<T extends { exp: number }>(typ: Typ, value: string | undefined): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", env.sessionSecret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { typ?: string };
  return payload.typ === typ && payload.exp > Date.now() ? payload : null;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export async function getSession(): Promise<Session | null> {
  try {
    return unsign<Session>("contributor", (await cookies()).get(SESSION)?.value);
  } catch {
    return null;
  }
}

export async function setSession(xUserId: string, username: string) {
  const maxAge = 7 * 86_400;
  (await cookies()).set(SESSION, sign("contributor", { xUserId, username, exp: Date.now() + maxAge * 1000 }), cookieOptions(maxAge));
}

export async function clearSession() {
  (await cookies()).delete(SESSION);
}

export async function getOwnerSession(): Promise<OwnerSession | null> {
  try {
    return unsign<OwnerSession>("owner", (await cookies()).get(OWNER)?.value);
  } catch {
    return null;
  }
}

export async function setOwnerSession(userId: string, address: string) {
  const maxAge = 7 * 86_400;
  (await cookies()).set(OWNER, sign("owner", { sub: userId, addr: address, exp: Date.now() + maxAge * 1000 }), cookieOptions(maxAge));
}

export async function clearOwnerSession() {
  (await cookies()).delete(OWNER);
}

export async function setOAuthState(value: Omit<OAuthState, "exp">) {
  (await cookies()).set(OAUTH, sign("oauth", { ...value, exp: Date.now() + 600_000 }), cookieOptions(600));
}

export async function takeOAuthState(): Promise<OAuthState | null> {
  const jar = await cookies();
  const value = unsign<OAuthState>("oauth", jar.get(OAUTH)?.value);
  jar.delete(OAUTH);
  return value;
}
