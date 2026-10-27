// The rolling 24-hour cap as program v2 counts it (`merit_core::rolling_paid`): hourly buckets, the last 24 hours.

export const HOUR_MS = 3_600_000;

export function rolling(hours: bigint[], paid: bigint[], nowMs = Date.now()): bigint {
  const now = BigInt(Math.floor(nowMs / HOUR_MS));
  let total = 0n;
  hours.forEach((hour, i) => {
    if (hour <= now && hour + 24n > now) total += paid[i] ?? 0n;
  });
  return total;
}
