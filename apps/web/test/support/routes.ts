// Route-handler tests: an in-memory cookie jar standing in for next/headers, and same-origin JSON requests.

import { NextRequest } from "next/server";

export const ORIGIN = "http://merit.test";

export class CookieJar {
  values = new Map<string, string>();
  get = (name: string) => (this.values.has(name) ? { name, value: this.values.get(name)! } : undefined);
  set = (name: string, value: string) => void this.values.set(name, value);
  delete = (name: string) => void this.values.delete(name);
  clear = () => this.values.clear();
}

export function request(path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
