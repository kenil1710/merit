import type { SVGProps } from "react";

/**
 * Merit's blob field: an original arrangement of rounded shapes (pills, petal-cornered
 * squares, circles, rings and soft blobs), ink on cream. Pure data so the landing hero and
 * the OG image (next/og) draw exactly the same shapes.
 */
export type Blob =
  | { kind: "pill"; x: number; y: number; w: number; h: number; r?: number; rotate?: number; fill: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: boolean }
  | { kind: "path"; d: string; fill: boolean };

/** A square with three round corners and one sharp one: Merit's "petal". */
function petal(x: number, y: number, s: number, sharp: "tl" | "tr" | "br" | "bl"): string {
  const r = s / 2;
  const c = { tl: sharp === "tl" ? 0 : r, tr: sharp === "tr" ? 0 : r, br: sharp === "br" ? 0 : r, bl: sharp === "bl" ? 0 : r };
  return [
    `M${x + c.tl} ${y}`,
    `H${x + s - c.tr}`,
    c.tr ? `A${c.tr} ${c.tr} 0 0 1 ${x + s} ${y + c.tr}` : "",
    `V${y + s - c.br}`,
    c.br ? `A${c.br} ${c.br} 0 0 1 ${x + s - c.br} ${y + s}` : "",
    `H${x + c.bl}`,
    c.bl ? `A${c.bl} ${c.bl} 0 0 1 ${x} ${y + s - c.bl}` : "",
    `V${y + c.tl}`,
    c.tl ? `A${c.tl} ${c.tl} 0 0 1 ${x + c.tl} ${y}` : "",
    "Z",
  ].join(" ");
}

export const BLOB_VIEWBOX = { width: 640, height: 520 };

export const BLOBS: Blob[] = [
  { kind: "path", d: petal(36, 40, 150, "bl"), fill: true },
  { kind: "pill", x: 214, y: 58, w: 230, h: 92, fill: false },
  { kind: "circle", cx: 532, cy: 104, r: 62, fill: true },
  { kind: "pill", x: 60, y: 226, w: 96, h: 236, fill: false },
  { kind: "path", d: "M214 252c40-46 128-52 170-8 38 40 28 104-14 136-50 38-132 34-164-14-22-34-20-82 8-114Z", fill: true },
  { kind: "path", d: petal(436, 214, 162, "tr"), fill: false },
  { kind: "circle", cx: 268, cy: 452, r: 34, fill: false },
  { kind: "pill", x: 342, y: 418, w: 188, h: 70, fill: true },
  { kind: "circle", cx: 590, cy: 460, r: 22, fill: true },
];

const STROKE = 3;

export function BlobField({ ink = "currentColor", ...props }: SVGProps<SVGSVGElement> & { ink?: string }) {
  return (
    <svg viewBox={`0 0 ${BLOB_VIEWBOX.width} ${BLOB_VIEWBOX.height}`} fill="none" aria-hidden="true" {...props}>
      {BLOBS.map((b, i) => {
        const paint = b.fill ? { fill: ink } : { stroke: ink, strokeWidth: STROKE };
        if (b.kind === "circle") return <circle key={i} cx={b.cx} cy={b.cy} r={b.fill ? b.r : b.r - STROKE / 2} {...paint} />;
        if (b.kind === "pill") {
          const inset = b.fill ? 0 : STROKE / 2;
          return (
            <rect
              key={i}
              x={b.x + inset}
              y={b.y + inset}
              width={b.w - 2 * inset}
              height={b.h - 2 * inset}
              rx={(b.r ?? Math.min(b.w, b.h) / 2) - inset}
              transform={b.rotate ? `rotate(${b.rotate} ${b.x + b.w / 2} ${b.y + b.h / 2})` : undefined}
              {...paint}
            />
          );
        }
        return <path key={i} d={b.d} {...paint} />;
      })}
    </svg>
  );
}

/** The small three-line mono label in a corner of the landing hero and the OG image. */
export const CORNER_LABEL = ["Merit · built on Rialo", "AI-verified work, paid on-chain", "DevNet"] as const;

export function CornerLabel({ className = "" }: { className?: string }) {
  return (
    <div className={`font-mono text-[11px] leading-[1.55] tracking-[0.02em] ${className}`}>
      {CORNER_LABEL.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
