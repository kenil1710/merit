import { headers } from "next/headers";
import { getOwnerSession } from "@/lib/server/session";
import { WizardLoader } from "./wizard-loader";

export const metadata = { title: "New program" };

/** Full-screen guided flow (no rail; see FOCUS_ROUTES): the wizard draws its own header and progress. */
export default async function NewProgramPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const session = await getOwnerSession();
  if (!session) return null;
  const raw = Number((await searchParams).step);
  const step = Math.min(5, Math.max(1, Number.isFinite(raw) ? raw : 1)) - 1;
  const host = (await headers()).get("host") ?? "merit";
  return <WizardLoader step={step} owner={session.addr} host={host} />;
}
