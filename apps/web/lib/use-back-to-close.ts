"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";

/**
 * Browser Back closes an open dialog, sheet or drawer instead of leaving the page.
 *
 * Opening pushes a history entry for the same URL (marked with the modal's id). Back pops it and the modal closes.
 * Closing from the UI (X, Escape, a button) consumes that entry again, so the next Back leaves the page as expected.
 * A click on an internal link inside the modal first closes it, then navigates, so no stray entry is left behind.
 */
const KEY = "__meritModal";

type HistoryState = Record<string, unknown> | null;
const marker = () => (window.history.state as HistoryState)?.[KEY];

export function useBackToClose(open: boolean, close: () => void, enabled = true) {
  const id = useId();
  const router = useRouter();
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const pushed = useRef(false);
  const openedAt = useRef<string | null>(null);
  const pendingHref = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (open && !pushed.current) {
      window.history.pushState(
        { ...(window.history.state as object), [KEY]: id },
        "",
        window.location.href,
      );
      pushed.current = true;
      openedAt.current = window.location.href;
    } else if (!open && pushed.current) {
      pushed.current = false;
      // Closed from the UI: give the entry back, unless a navigation already moved the page on.
      if (marker() === id && window.location.href === openedAt.current) window.history.back();
      else if (pendingHref.current) {
        const href = pendingHref.current;
        pendingHref.current = null;
        router.push(href);
      }
    }
  }, [open, enabled, id, router]);

  useEffect(() => {
    if (!enabled) return;
    const onPop = () => {
      if (pendingHref.current && marker() !== id) {
        // The entry was given back after a link click inside the modal: now go where the link points (after
        // Next has handled this popstate, or its restore would win over the push).
        const href = pendingHref.current;
        pendingHref.current = null;
        setTimeout(() => router.push(href), 0);
        return;
      }
      if (pushed.current && marker() !== id) {
        pushed.current = false;
        closeRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled, id, router]);

  // Internal links inside the open modal: close first, then navigate (see above).
  useEffect(() => {
    if (!enabled || !open) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (!a.closest("[role=dialog]")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return; // a same-page anchor
      e.preventDefault();
      pendingHref.current = `${url.pathname}${url.search}${url.hash}`;
      closeRef.current();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, open]);
}
