import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BoxArt,
  CoinsArt,
  CopyArt,
  LinkArt,
  RubricArt,
  SealArt,
  StackArt,
  VaultArt,
} from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail for nested pages; the last item is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? (
              <ChevronRight className="size-3.5 opacity-60" strokeWidth={1.5} aria-hidden="true" />
            ) : null}
            {c.href ? (
              <Link href={c.href} className="hover:text-foreground rounded-sm transition-colors">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Breadcrumbs, title, one-line description and the page's primary action, the same on every page. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  crumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <div>
      {crumbs?.length ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[2.25rem] leading-[1.05] sm:text-[2.75rem]">{title}</h1>
            {meta}
          </div>
          {description ? (
            <p className="text-soft mt-2.5 max-w-[60ch] text-[15px] leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A bordered surface with an optional title row; the one card style for content blocks. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("bg-card shadow-soft scroll-mt-24 rounded-[20px] p-5 sm:p-7", className)}
    >
      {title ? (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One number with its label, as a visual anchor: the number in display type. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card shadow-soft rounded-[20px] p-5", className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="display mt-2 text-[2.5rem] leading-none tabular-nums">{value}</div>
      {hint ? (
        <div className="text-muted-foreground mt-2.5 text-xs leading-relaxed">{hint}</div>
      ) : null}
    </div>
  );
}

const ART = {
  box: BoxArt,
  coins: CoinsArt,
  copy: CopyArt,
  link: LinkArt,
  rubric: RubricArt,
  seal: SealArt,
  stack: StackArt,
  vault: VaultArt,
} as const;
export type EmptyArt = keyof typeof ART;

/**
 * Empty state: an illustration, a short title, one sentence on why it's empty and what fills it, and (when there
 * is one) one clear action. Without `art`/`title` it stays the quiet one-liner.
 */
export function EmptyState({
  children,
  action,
  art,
  title,
  className,
}: {
  children: ReactNode;
  action?: { label: string; href: string };
  art?: EmptyArt;
  title?: string;
  className?: string;
}) {
  const Art = art ? ART[art] : null;
  return (
    <div
      className={cn(
        "bg-card/50 grid justify-items-center rounded-[20px] border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Art ? <Art className="mb-4 size-20" /> : null}
      {title ? <p className="display text-[1.5rem] leading-tight">{title}</p> : null}
      <p className={cn("text-soft max-w-[46ch] text-sm leading-relaxed", title && "mt-1.5")}>
        {children}
      </p>
      {action ? (
        <Button asChild size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "danger" | "info";
  children: ReactNode;
}) {
  const styles = {
    warning: "bg-warning-subtle text-warning",
    danger: "bg-danger-subtle text-danger",
    info: "bg-brand-subtle text-brand",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-xl px-4 py-3 text-sm leading-relaxed", styles)}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid content-start gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-[1.75rem] leading-tight">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Wraps a table so wide content scrolls inside its border instead of the page. */
export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card shadow-soft overflow-x-auto rounded-[20px] px-1 [&_tr:last-child]:border-b-0">
      {children}
    </div>
  );
}
