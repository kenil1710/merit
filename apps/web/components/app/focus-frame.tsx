import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Full-screen guided flows (the new program wizard, going live) leave the rail behind: these URL patterns render
 * without the shell, and each page draws its own FocusHeader.
 */
const FOCUS_ROUTES = [/^\/app\/programs\/new\/?$/, /^\/app\/programs\/[0-9a-f-]{36}\/setup\/?$/];
export const isFocusRoute = (path: string) => FOCUS_ROUTES.some((r) => r.test(path));

/** The one header of a guided flow: the logo, the flow's progress in the middle, and a calm way out. */
export function FocusHeader({ progress, exit, status }: { progress?: ReactNode; exit?: ReactNode; status?: ReactNode }) {
  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-30 border-b supports-[backdrop-filter]:backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-4 px-4 sm:px-8">
        <Link href="/app" aria-label="Merit home" className="shrink-0 rounded-md">
          <Wordmark />
        </Link>
        <div className="flex min-w-0 flex-1 justify-center">{progress}</div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {status ? <span className="hidden items-center sm:flex">{status}</span> : null}
          {exit}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function FocusMain({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={className ?? "mx-auto w-full max-w-[1240px] px-4 pb-16 sm:px-8"}>
      {children}
    </main>
  );
}
