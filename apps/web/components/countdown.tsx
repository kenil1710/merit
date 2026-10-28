"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { countdownText } from "@/lib/when";

/** How often to ask the server again while a reached deadline hasn't moved yet (the chain flips phase a beat later). */
const RETRY_MS = 10_000;
const MAX_RETRIES = 30;

/**
 * A countdown that ticks every second. When it reaches zero it refreshes the page's server data, so the status and
 * the next deadline come from the chain again; until the deadline moves it asks again every 10 seconds.
 */
export function Countdown({ to, prefix, className }: { to: number; prefix?: string; className?: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const retries = useRef(0);
  useEffect(() => {
    retries.current = 0;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [to]);
  const done = now >= to;
  useEffect(() => {
    if (!done) return;
    router.refresh();
    const timer = setInterval(() => {
      if (++retries.current > MAX_RETRIES) return clearInterval(timer);
      router.refresh();
    }, RETRY_MS);
    return () => clearInterval(timer);
  }, [done, router]);
  return (
    <span className={className} data-testid="countdown" suppressHydrationWarning>
      {prefix ? `${prefix} ` : ""}
      {done ? "a moment" : countdownText(to - now)}
    </span>
  );
}
