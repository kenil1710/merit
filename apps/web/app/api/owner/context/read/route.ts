// Owner: "Read it". The agent reads the program's text and links once and drafts what it understood, for the owner
// to check and edit before saving. Runs in the request: links in parallel, one model call, all within 20 seconds
// (READ_DEADLINE_MS); every model call goes through merit-judge.

import { NextResponse, type NextRequest } from "next/server";
import { readContext } from "@/lib/agent/context";
import { ContextReadInput } from "@/lib/shared/context";
import { configured, env } from "@/lib/server/env";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { judgeClient } from "@/lib/server/latch";
import { allow } from "@/lib/server/rate-limit";
import { pageText, safeFetchHtml } from "@/lib/server/safe-fetch";
import { getOwnerSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("Your session expired. Sign in again.", 401);
  if (!allow(`context-read:${session.sub}`, 10, 10 * 60_000)) return jsonError("That's a lot of reads. Wait a few minutes and try again.", 429);
  const body = ContextReadInput.safeParse(await readJson(request));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Check the description and links.", 400);
  const result = await readContext(
    { about: body.data.about, links: body.data.links },
    {
      fetchPage: async (url) => {
        const page = await safeFetchHtml(url);
        return page.html ? pageText(page.html) : null;
      },
      // No campaign or contributor yet: the owner's reads are tagged and rate-limited as owner-<user id>.
      client: configured(env.judgeLat).ok ? judgeClient(`owner-${session.sub}`).messages : null,
      userId: `owner-${session.sub}`,
    },
  );
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
