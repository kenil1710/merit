"use client";

import { Compass, FileCheck2, Menu, PenLine, Rocket, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { shortHex } from "@/components/hex-value";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useUnlockedWallet } from "@/lib/client/owner-wallet";
import { useSavedAddress } from "@/lib/client/use-wallet";
import { openWalletPanel } from "@/lib/client/wallet";
import { cn } from "@/lib/utils";

/**
 * App frame: an icon + label rail on the left (wordmark on top, wallet chip at the bottom). Below 1024px: a header
 * with the menu sheet.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="bg-sidebar hidden w-64 shrink-0 lg:block">
        <aside className="sticky top-0 h-dvh">
          <AppSidebar />
        </aside>
      </div>
      <header className="bg-background/85 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 flex h-14 items-center justify-between gap-2 px-3 supports-[backdrop-filter]:backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-1">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" strokeWidth={1.5} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Link href="/" aria-label="Merit home" className="rounded-md">
            <Wordmark />
          </Link>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1160px] px-4 pt-6 pb-16 sm:px-8 lg:px-10 lg:pt-10">{children}</div>
      </main>
    </div>
  );
}

/** /c/<address> is a campaign's public record (Explore); /c and /c/<slug> are the contributor's pages (Contribute). */
const CAMPAIGN_PATH = /^\/c\/[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CONTRIBUTOR_PATH = /^\/c(\/[a-z0-9-]{3,40})?$/;

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col gap-7 px-4 py-5">
      <div className="px-2">
        <Link href="/" aria-label="Merit home" className="rounded-md" onClick={onNavigate}>
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Main" className="grid gap-0.5">
        <NavItem href="/explore" icon={Compass} label="Explore" path={path} onNavigate={onNavigate} also={CAMPAIGN_PATH} />
        <NavItem href="/join" icon={PenLine} label="Contribute" path={path} onNavigate={onNavigate} also={CONTRIBUTOR_PATH} />
        <NavItem href="/app" icon={Rocket} label="Run a campaign" path={path} onNavigate={onNavigate} also="/owner" />
        <NavItem href="/guardrails" icon={ShieldCheck} label="Guardrails" path={path} onNavigate={onNavigate} />
        <NavItem href="/security" icon={FileCheck2} label="Security" path={path} onNavigate={onNavigate} />
      </nav>

      <div className="grid gap-1.5 px-3">
        <p className="label">Network</p>
        <p className="text-soft text-sm">Rialo DevNet</p>
        <p className="text-muted-foreground text-xs leading-relaxed">RLO here is test currency from the faucet.</p>
      </div>

      <div className="mt-auto grid gap-2">
        <WalletChip />
        <div className="flex items-center justify-between px-1">
          <span className="text-muted-foreground text-xs">Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/** The wallet in this browser; opens the wallet panel (create, unlock, faucet, backup, forget). */
function WalletChip() {
  const address = useSavedAddress();
  const unlocked = useUnlockedWallet()?.publicKey.toString() === address && address !== null;
  return (
    <button
      type="button"
      onClick={openWalletPanel}
      className="bg-card shadow-soft hover:bg-card/80 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-3"
      data-testid="wallet-chip"
      aria-label="Open wallet"
    >
      <Wallet className="text-brand size-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-xs">{address ? (unlocked ? "Wallet · unlocked" : "Wallet · locked") : "Wallet in this browser"}</span>
        <span className="block truncate font-mono text-[13px]">{address ? shortHex(address) : "Create one"}</span>
      </span>
    </button>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  path,
  also,
  onNavigate,
}: {
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  path: string;
  also?: string | RegExp;
  onNavigate?: () => void;
}) {
  const active = path === href || path.startsWith(`${href}/`) || (also ? (typeof also === "string" ? path.startsWith(also) : also.test(path)) : false);
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (e.detail > 0) e.currentTarget.blur();
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-foreground/20 flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-card text-foreground shadow-soft font-medium [&_svg]:text-brand"
          : "text-soft hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1">{label}</span>
    </Link>
  );
}
