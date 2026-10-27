import "server-only";

// Server configuration. Every getter fails closed with a message that names
// the missing variable; values are never logged.

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set on the server`);
  return value;
}

export const env = {
  judgeLat: () => required("MERIT_JUDGE_LAT"),
  xLat: () => required("MERIT_X_LAT"),
  /// DevNet agent authority (base58 64-byte secret key or 32-byte seed).
  agentSecret: () => required("MERIT_AGENT_SECRET_KEY"),
  sessionSecret: () => {
    const value = required("MERIT_SESSION_SECRET");
    if (value.length < 32) throw new ConfigError("MERIT_SESSION_SECRET must be at least 32 characters");
    return value;
  },
  xClientId: () => required("X_CLIENT_ID"),
  xClientSecret: () => required("X_CLIENT_SECRET"),
  publicUrl: () => required("MERIT_PUBLIC_URL").replace(/\/$/, ""),
};

export function configured(...getters: (() => string)[]): { ok: true } | { ok: false; missing: string } {
  for (const get of getters) {
    try {
      get();
    } catch (error) {
      return { ok: false, missing: (error as Error).message };
    }
  }
  return { ok: true };
}
