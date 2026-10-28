"use client";

import {
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Compass,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  Menu,
  PenLine,
  Plus,
  Repeat,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { Countdown } from "@/components/countdown";
import { shortHex } from "@/components/hex-value";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useOwnerWallet } from "@/lib/client/owner-wallet";
import { openWalletPanel } from "@/lib/client/wallet";
import { accountRole } from "@/lib/shared/account-role";
import type { RoundPillData } from "@/lib/server/program-summary";
import { cn } from "@/lib/utils";
import { isFocusRoute } from "./focus-frame";

export interface ShellProgram {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "paused" | "archived";
  /** The signed-in wallet's role in this program. */
  role: "owner" | "reviewer";
  /** Submissions waiting for a person. */
  review: number;
  /** "Round 1 · Open" and its live countdown, or null before the campaign exists. */
  roundPill: RoundPillData | null;
  needs: { text: string; href: string; action: string; kind: string }[];
}

type Need = ShellProgram["needs"][number] & { programName?: string };

const STATUS_DOT: Record<ShellProgram["status"], string> = {
  active: "bg-success",
  draft: "bg-muted-foreground/50",
  paused: "bg-warning",
  archived: "bg-muted-foreground/30",
};

/**
 * The owner app frame (Misthos' shell): a rail with the program switcher, the program's pages, the workspace and the
 * account chip; a top bar with the round pill, "Needs you" and the theme. Below 1024px: a header with a menu sheet.
 * Guided flows (the wizard, go-live) take the whole screen and draw their own header.
 */
export function OwnerShell({ programs, address, children }: { programs: ShellProgram[]; address: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const currentId = /^\/app\/programs\/([0-9a-f-]{36})/.exec(path)?.[1];
  const current = programs.find((p) => p.id === currentId);
  const needs: Need[] = current ? current.needs : programs.flatMap((p) => p.needs.map((n) => ({ ...n, programName: p.name })));
  if (isFocusRoute(path)) return <div className="flex min-h-dvh flex-col">{children}</div>;
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="bg-sidebar hidden w-64 shrink-0 lg:block">
        <aside className="sticky top-0 h-dvh">
          <OwnerSidebar programs={programs} current={current} address={address} />
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
              <OwnerSidebar programs={programs} current={current} address={address} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Link href="/" aria-label="Merit home" className="rounded-md">
            <Wordmark />
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <NeedsBell needs={needs} />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 sm:px-8 lg:px-10">
          <div className="bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 supports-[backdrop-filter]:backdrop-blur-md lg:flex">
            <div className="flex min-w-0 items-center gap-2">{current?.roundPill ? <RoundPill pill={current.roundPill} /> : null}</div>
            <div className="flex items-center gap-1.5">
              <DevNetBadge />
              <NeedsBell needs={needs} />
              <ThemeToggle />
            </div>
          </div>
          {current?.roundPill ? (
            <div className="pt-4 lg:hidden">
              <RoundPill pill={current.roundPill} />
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)] pt-6 lg:pt-4">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function DevNetBadge() {
  return (
    <span className="bg-muted text-soft inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium" title="Merit runs on Rialo DevNet: RLO here is test currency.">
      <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
      Rialo DevNet · test RLO
    </span>
  );
}

function OwnerSidebar({ programs, current, address, onNavigate }: { programs: ShellProgram[]; current?: ShellProgram; address: string; onNavigate?: () => void }) {
  const path = usePathname();
  const base = current ? `/app/programs/${current.id}` : null;
  const nav = (href: string, icon: Icon, label: string, opts: { exact?: boolean; badge?: ReactNode } = {}) => (
    <NavItem key={href} href={href} icon={icon} label={label} path={path} onNavigate={onNavigate} {...opts} />
  );
  return (
    <div className="flex h-full flex-col gap-7 px-4 py-5">
      <div className="px-2">
        <Link href="/" aria-label="Merit home" className="rounded-md" onClick={onNavigate}>
          <Wordmark />
        </Link>
      </div>

      <ProgramSwitcher programs={programs} current={current} onNavigate={onNavigate} />

      <nav aria-label="Program" className="grid gap-0.5">
        {base && current
          ? [
              nav(base, LayoutDashboard, "Overview", { exact: true }),
              nav(`${base}/submissions`, Inbox, "Submissions", { badge: current.review ? <CountBadge n={current.review} /> : null }),
              nav(`${base}/contributors`, Users, "Contributors"),
              nav(`${base}/rounds`, Repeat, "Rounds"),
              nav(`${base}/treasury`, Landmark, "Treasury"),
              nav(`${base}/audit`, ScrollText, "Audit log"),
              nav(`${base}/settings`, Settings, "Settings"),
            ]
          : nav("/app/programs", Layers, "All programs", { exact: true })}
      </nav>

      <div className="grid gap-0.5">
        <p className="text-muted-foreground px-3 pb-1 text-xs">Workspace</p>
        {current ? nav("/app/programs", Layers, "All programs", { exact: true }) : null}
        {nav("/app/metrics", BarChart3, "Metrics")}
        {nav("/explore", Compass, "Explore campaigns")}
        {nav("/join", PenLine, "Contribute")}
        {nav("/guardrails", ShieldCheck, "Guardrails")}
      </div>

      <div className="mt-auto">
        <AccountChip address={address} role={accountRole(programs, current)} />
      </div>
    </div>
  );
}

function ProgramSwitcher({ programs, current, onNavigate }: { programs: ShellProgram[]; current?: ShellProgram; onNavigate?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-card shadow-soft hover:bg-card/80 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3">
        {current ? (
          <>
            <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[current.status])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground flex-1">{programs.length ? "Choose a program" : "No programs yet"}</span>
        )}
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">Switch program</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(e) => {
          if (!document.querySelector(":focus-visible")) e.preventDefault();
        }}
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        {programs.length ? <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Programs</DropdownMenuLabel> : null}
        {programs.map((p) => (
          <DropdownMenuItem key={p.id} asChild>
            <Link href={`/app/programs/${p.id}`} onClick={onNavigate} className="gap-2.5">
              <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[p.status])} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === current?.id ? <Check className="size-4" strokeWidth={1.5} /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        {programs.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link href="/app/programs/new" onClick={onNavigate} className="gap-2.5">
            <Plus className="size-4" strokeWidth={1.5} />
            New program
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in wallet with its role; opens the wallet panel (balance, faucet, Lock and sign out, backup, forget). */
function AccountChip({ address, role }: { address: string; role: "Owner" | "Reviewer" }) {
  const { keypair } = useOwnerWallet();
  const unlocked = keypair?.publicKey.toString() === address;
  return (
    <button
      type="button"
      onClick={openWalletPanel}
      className="bg-card shadow-soft hover:bg-card/80 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-3"
      data-testid="account-chip"
      aria-label="Open wallet"
    >
      <Wallet className="text-brand size-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-xs">
          <span data-testid="account-role">{role}</span> · {unlocked ? "unlocked" : "locked"}
        </span>
        <span className="block truncate font-mono text-[13px]">{shortHex(address)}</span>
      </span>
      <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

function NavItem({
  href,
  icon: Icon,
  label,
  path,
  exact = false,
  badge,
  onNavigate,
}: {
  href: string;
  icon: Icon;
  label: string;
  path: string;
  exact?: boolean;
  badge?: ReactNode;
  onNavigate?: () => void;
}) {
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
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
        active ? "bg-card text-foreground shadow-soft [&_svg]:text-brand font-medium" : "text-soft hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1">{label}</span>
      {badge}
    </Link>
  );
}

const PILL_TONE: Record<RoundPillData["tone"], string> = { live: "bg-success", wait: "bg-warning", idle: "bg-muted-foreground/60" };

export function RoundPill({ pill, className }: { pill: RoundPillData; className?: string }) {
  return (
    <span className={cn("bg-card shadow-soft inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-sm whitespace-nowrap", className)} data-testid="round-pill">
      <span className={cn("size-1.5 rounded-full", PILL_TONE[pill.tone])} aria-hidden="true" />
      {pill.text}
      {pill.countdown ? (
        <span className="text-muted-foreground tabular-nums">
          {" "}· <Countdown to={pill.countdown.toMs} prefix={pill.countdown.prefix} />
        </span>
      ) : null}
    </span>
  );
}

export function NeedsBell({ needs }: { needs: Need[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={needs.length ? `Needs you: ${needs.length}` : "Needs you: nothing"}>
          <Bell className="size-4" strokeWidth={1.75} />
          {needs.length ? (
            <span className="bg-foreground text-background absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
              {needs.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="px-2 pt-1 pb-2 text-sm font-medium">Needs you</DropdownMenuLabel>
        {needs.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 px-2 pb-2 text-sm">
            <CheckCircle2 className="text-success size-4" strokeWidth={1.75} aria-hidden="true" />
            You&apos;re all caught up.
          </p>
        ) : (
          needs.map((n, i) => (
            <DropdownMenuItem key={`${n.href}-${i}`} asChild className="items-start rounded-lg p-2">
              <Link href={n.href} className="grid gap-0.5">
                {n.programName ? <span className="text-muted-foreground text-xs">{n.programName}</span> : null}
                <span className="text-sm leading-snug">{n.text}</span>
                <span className="text-brand text-xs font-medium">{n.action} →</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="bg-warning-subtle text-warning inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums" aria-label={`${n} need review`} data-testid="review-badge">
      {n}
    </span>
  );
}
