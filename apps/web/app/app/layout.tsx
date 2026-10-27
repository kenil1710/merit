import Link from "next/link";
import type { ReactNode } from "react";
import { OwnerAppShell } from "@/components/app/owner-app-shell";
import { DevNetBadge } from "@/components/app/owner-shell";
import { OwnerSignIn } from "@/components/app/owner-sign-in";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { OwnerWalletProvider } from "@/lib/client/owner-wallet";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: { default: "App", template: "%s · Merit" } };

/** The owner app: signed in, the shell with your programs; signed out, the sign-in screen (Misthos' layout). */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const session = await getOwnerSession();
  return (
    <OwnerWalletProvider>
      {session ? (
        <OwnerAppShell session={session}>{children}</OwnerAppShell>
      ) : (
        <div className="flex min-h-dvh flex-col">
          <header className="flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/" aria-label="Merit home" className="rounded-md">
              <Wordmark />
            </Link>
            <div className="flex items-center gap-1">
              <DevNetBadge />
              <ThemeToggle />
            </div>
          </header>
          <main
            id="main"
            className="mx-auto grid w-full max-w-[1080px] flex-1 content-start items-start gap-10 px-4 pt-[6vh] pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16 lg:pt-[10vh]"
          >
            <section className="order-2 lg:order-1" aria-labelledby="owner-pitch">
              <p className="text-brand text-sm font-medium">For projects and teams</p>
              <h2 id="owner-pitch" className="display mt-2 text-[2.25rem] leading-[1.05] sm:text-[2.75rem]">
                <span className="block">Launch a campaign.</span>
                <span className="block">
                  AI pays your community for <em>real</em> work.
                </span>
              </h2>
              <ul className="text-soft mt-6 grid gap-3 text-[15px] leading-relaxed">
                {[
                  "Fund an escrow on Rialo and set the rules: what counts, what it pays, the limits.",
                  "An AI agent checks every post, scores it and explains why; validators confirm it with REX.",
                  "Good work is paid by the program's own timers when each round closes, never above its caps.",
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="bg-brand mt-2.5 size-1.5 shrink-0 rounded-full" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
              <DecisionPreview />
            </section>
            <div className="order-1 grid gap-4 lg:order-2">
              <section className="bg-card shadow-soft rounded-2xl border p-6 sm:p-8">
                <h1 className="text-xl font-medium tracking-tight">Sign in to Merit</h1>
                <p className="text-muted-foreground mt-1.5 mb-7 text-sm leading-relaxed">With the Rialo wallet that owns your campaigns.</p>
                <OwnerSignIn />
              </section>
              <p className="text-muted-foreground px-1 text-sm leading-relaxed">
                Posting for a campaign?{" "}
                <Link href="/join" className="text-foreground underline underline-offset-4">
                  Contribute
                </Link>{" "}
                and sign in with X.
              </p>
            </div>
          </main>
        </div>
      )}
    </OwnerWalletProvider>
  );
}

/** A small, static picture of what the agent produces: a decision anchored on chain and the payout that followed. */
function DecisionPreview() {
  return (
    <figure aria-label="Example: a decision and its payout" className="bg-card shadow-soft mt-10 max-w-md rounded-2xl border p-5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">@alice_builds · thread</span>
        <span className="bg-success-subtle text-success rounded-full px-2.5 py-0.5 text-xs font-medium">Verified 4/4</span>
      </div>
      <p className="text-soft mt-2 leading-relaxed">Explains how Rialo programs arm their own timers, with a working example. Depth 8/10, clarity 9/10.</p>
      <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
        <span>Record hash on chain · REX unanimous</span>
        <span className="text-foreground font-medium tabular-nums">Paid 0.0085 RLO</span>
      </div>
    </figure>
  );
}
