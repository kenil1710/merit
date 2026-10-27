import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getProgramForMember } from "./programs";
import { getOwnerSession } from "./session";

/** A program page's guard: signed in and a member, or 404 (never 403: non-members don't learn it exists). */
export async function memberProgram(id: string) {
  const session = await getOwnerSession();
  if (!session || !z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const found = await getProgramForMember(db, id, session.sub);
  if (!found) notFound();
  return { db, session, ...found, base: `/app/programs/${id}` };
}
