// "Try a bad request": sends one deliberately bad request through a latch and returns Latch's real answer. Latch is
// asked first (/latch-self/authorize) and the request is sent only when Latch says deny, so a probe never reaches
// Anthropic or X and never spends. See lib/server/latch-probes.ts.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { configured, env } from "@/lib/server/env";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { PROBES, liveCampaign, runProbe, type ProbeKey } from "@/lib/server/latch-probes";
import { allow, ipKey, rule } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ probe: z.enum(Object.keys(PROBES) as [ProbeKey, ...ProbeKey[]]) });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  if (!(await allow(rule(`probe:${ipKey(request)}`, 10, 60_000), rule("probe:all", 60, 60_000)))) return jsonError("Too many probes. Wait a minute.", 429);
  const body = Body.safeParse(await readJson(request));
  if (!body.success) return jsonError("Unknown probe.", 400);
  const probe = PROBES[body.data.probe];
  const ready = configured(probe.latch === "merit-judge" ? env.judgeLat : env.xLat);
  if (!ready.ok) return jsonError(ready.missing, 503);
  const campaign = (await liveCampaign(await getDb()).catch(() => null)) ?? "5LyXppXdVZHcV6bcWjJkTyir3F9PM5TEx6pTTA9jEiwv";
  return NextResponse.json({ ...(await runProbe(body.data.probe, campaign)), campaign }, { headers: { "Cache-Control": "no-store" } });
}
