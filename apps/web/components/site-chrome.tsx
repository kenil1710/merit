import Link from "next/link";
import { Mark, Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { PROGRAM_ID } from "@/lib/merit/constants";

export const PAPER_URL = "https://www.rialo.io/posts/reactive-transactions-a-model-for-native-automation-on-rialo";

export function SiteHeader() {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 supports-[backdrop-filter]:backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Merit home" className="rounded-md">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <div className="hidden items-center gap-1 md:flex">
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <Link href="/explore">Explore</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <a href="/#how-it-works">How it works</a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-soft">
              <Link href="/guardrails">Guardrails</Link>
            </Button>
          </div>
          <ThemeToggle />
          <Button asChild size="sm" className="ml-1">
            <Link href="/join">Contribute</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

const poweredBy = [
  { name: "Rialo Workflow", text: "Each campaign and round ledger is a Venus workflow holding its own escrow and state." },
  { name: "Execution Engine · Conditional Transactions", text: "AFTER timers close, settle and reopen rounds on chain. No keeper, no cron." },
  { name: "Rialo Edge", text: "Validators fetch the X post themselves with http::get; nothing off chain vouches for it." },
  { name: "REX confidential computing", text: "The X credential is encrypted to the validators' TEE key and decrypted only inside the enclave." },
];

export function SiteFooter() {
  return (
    <footer className="bg-card mt-32 rounded-t-[2rem] md:mt-40">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 pt-16 pb-10 sm:px-6 md:grid-cols-12 md:pt-20">
        <div className="md:col-span-4">
          <Wordmark />
          <p className="text-soft mt-4 max-w-xs leading-relaxed">
            Pay contributors in RLO for work the chain has verified. Live on Rialo DevNet.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app">Run a campaign</Link>
          </Button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 md:col-span-8">
          {poweredBy.map((item) => (
            <div key={item.name}>
              <p className="font-medium">{item.name}</p>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 border-t px-4 py-6 text-xs sm:px-6">
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <Mark className="text-brand size-4" />
          Program <span className="font-mono">{PROGRAM_ID.slice(0, 8)}…</span> on Rialo DevNet · Latch governs every API credential.
        </span>
        <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" href="/security">
            Security
          </Link>
          <Link className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" href="/guardrails">
            Guardrails
          </Link>
          <a className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" href={PAPER_URL} target="_blank" rel="noreferrer">
            Reactive Transactions: A Model for Native Automation on Rialo
          </a>
        </span>
      </div>
    </footer>
  );
}
