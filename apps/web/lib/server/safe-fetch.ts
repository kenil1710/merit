import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { FetchError } from "@/lib/agent/types";

/**
 * SSRF-safe fetch for links an owner gives the agent to read (Misthos' fetcher):
 *  - http/https only, default ports only, no credentials in the URL
 *  - every resolved address is checked at connect time (no DNS rebinding) against loopback, private, link-local
 *    (cloud metadata), CGNAT, multicast and reserved ranges
 *  - redirects followed by hand (max 3), each hop checked again
 *  - 10 s timeout, 2 MB cap, HTML only
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32], // Teredo: tunnels IPv4, including private addresses
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4: embeds an IPv4 address (2002:7f00:1:: is 127.0.0.1)
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const addr = mapped ? mapped[1]! : address;
  const family = isIP(addr);
  if (family === 0) return false;
  if (family === 6 && /^::ffff:/i.test(addr)) return false; // hex-form mapped addresses: refuse rather than parse
  return !blocked.check(addr, family === 6 ? "ipv6" : "ipv4");
}

const guardedLookup: typeof dnsLookup = ((
  hostname: string,
  options: object,
  callback: (...a: unknown[]) => void,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0)
      return callback(new FetchError("That address isn't a public web page.", false));
    // undici asks with all:true; honor whichever shape was requested.
    if ((options as { all?: boolean }).all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}) as typeof dnsLookup;

const agent = new Agent({
  connect: { lookup: guardedLookup },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
});

export const MAX_BYTES = 2 * 1024 * 1024;

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("Invalid URL", false);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new FetchError("Only web links are supported.", false);
  if (url.username || url.password)
    throw new FetchError("Links with credentials aren't allowed.", false);
  if (url.port && url.port !== "80" && url.port !== "443")
    throw new FetchError("Non-standard ports aren't allowed.", false);
  if (
    isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
    !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))
  ) {
    throw new FetchError("That address isn't a public web page.", false);
  }
  return url;
}

export async function safeFetchHtml(raw: string): Promise<{ finalUrl: string; status: number; html: string }> {
  let url = assertFetchableUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "MeritBot/1.0 (Rialo DevNet contributor programs)", Accept: "text/html,application/xhtml+xml" },
      });
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      if (cause instanceof FetchError) throw cause;
      throw new FetchError("The page couldn't be reached.", true);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = assertFetchableUrl(new URL(res.headers.get("location")!, url).toString());
      await res.body?.cancel();
      continue;
    }
    if (res.status === 404 || res.status === 410) return { finalUrl: url.toString(), status: res.status, html: "" };
    if (!res.ok) throw new FetchError(`The site returned ${res.status}.`, res.status === 429 || res.status >= 500, res.status);
    if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")) throw new FetchError("The link isn't a web page.", false);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new FetchError("The page is too large.", false);
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new FetchError("The page is too large.", false);
      }
      chunks.push(value);
    }
    return { finalUrl: url.toString(), status: res.status, html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new FetchError("Too many redirects.", false);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(Number(e[1] === "x" || e[1] === "X" ? `0${e.slice(1)}` : e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)));

/**
 * A page's readable text, title and hidden text (comments, hidden elements, alt/title attributes). Hidden text is
 * only scanned for instructions aimed at the agent; it is never summarized.
 */
export function pageText(html: string): { title: string | null; text: string; hidden: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const hidden = [
    ...[...html.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]),
    ...[...html.matchAll(/<([a-z0-9]+)[^>]*(?:hidden|display:\s*none|visibility:\s*hidden|aria-hidden="true")[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]),
    ...[...html.matchAll(/\s(?:alt|title)="([^"]*)"/gi)].map((m) => m[1]),
  ]
    .join(" ")
    .replace(/<[^>]+>/g, " ");
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const clean = (s: string) => decode(s).replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
  return { title: title ? clean(title).slice(0, 200) : null, text: clean(body).slice(0, 50_000), hidden: clean(hidden).slice(0, 20_000) };
}
