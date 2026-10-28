/** "Fri 2 Oct 2026, 8:00 PM GMT+5:30 · 14:30 UTC". Uses the viewer's zone: call from client components. */
export function localAndUtc(d: Date): string {
  const local = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  })
    .format(d)
    .replace(/ at /, ", ")
    .replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
  return `${local} · ${d.toISOString().slice(11, 16)} UTC`;
}

/** "in 6 days", "in 3 hours", "now", "2 days ago". */
export function fromNow(d: Date, now: number = Date.now()): string {
  const ms = d.getTime() - now;
  const abs = Math.abs(ms);
  const unit =
    abs >= 86_400_000 ? ([Math.round(abs / 86_400_000), "day"] as const)
    : abs >= 3_600_000 ? ([Math.round(abs / 3_600_000), "hour"] as const)
    : abs >= 60_000 ? ([Math.round(abs / 60_000), "minute"] as const)
    : null;
  if (!unit) return "now";
  const text = `${unit[0]} ${unit[1]}${unit[0] === 1 ? "" : "s"}`;
  return ms > 0 ? `in ${text}` : `${text} ago`;
}

/** Value for <input type="datetime-local"> in the viewer's zone. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Compact countdown for pills: "6d 4h", "5h 20m", "12m", "now". */
export function shortFromNow(d: Date, now: number = Date.now()): string {
  const ms = Math.max(0, d.getTime() - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "now";
}

/** A live countdown, to the second under a day: "2d 4h", "1h 05m 09s", "4m 05s", "12s", "now". */
export function countdownText(ms: number): string {
  if (ms <= 0) return "now";
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const mins = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${p(mins)}m ${p(secs)}s`;
  if (mins > 0) return `${mins}m ${p(secs)}s`;
  return `${secs}s`;
}

/** "5 minutes", "2 hours", "7 days". */
export function minutesLabel(minutes: number): string {
  const [n, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
