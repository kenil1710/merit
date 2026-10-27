import type { ReactNode } from "react";
import { getDb } from "@/lib/db";
import { programSummaries } from "@/lib/server/program-summary";
import { programsForMember, type Role } from "@/lib/server/programs";
import type { OwnerSession } from "@/lib/server/session";
import { OwnerShell } from "./owner-shell";

/** The signed-in owner's frame with their programs, their round pills and what needs them. */
export async function OwnerAppShell({ session, children }: { session: OwnerSession; children: ReactNode }) {
  const programs = await programsForMember(await getDb(), session.sub);
  const roles = new Map<string, Role>(programs.map((p) => [p.id, p.role]));
  const summaries = await programSummaries(programs);
  return (
    <OwnerShell
      address={session.addr}
      programs={summaries.map(({ program: p, roundPill, needs, review }) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.endedAt ? "archived" : p.status,
        role: roles.get(p.id) ?? "owner",
        review,
        roundPill,
        needs,
      }))}
    >
      {children}
    </OwnerShell>
  );
}
