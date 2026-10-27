import type { SVGProps } from "react";

/**
 * Merit illustrations: soft isometric shapes drawn from the theme tokens, so they follow light and dark mode.
 * Faces use three tones of the brand (deep, tint, subtle) plus the surface colour for highlights; round joins keep
 * the edges soft. Decorative: always aria-hidden.
 */

type P = SVGProps<SVGSVGElement>;
const deep = "var(--art-deep)";
const mid = "var(--art-mid)";
const light = "var(--art-light)";
const paper = "var(--art-paper)";
const line = { strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Svg({ children, viewBox = "0 0 120 120", ...p }: P) {
  return (
    <svg viewBox={viewBox} fill="none" aria-hidden="true" focusable="false" {...p}>
      {children}
    </svg>
  );
}

/** A rounded isometric block: the base of the vault, the box, the sheet. */
function Block({
  x = 60,
  y = 60,
  w = 40,
  h = 40,
  top = light,
  left = mid,
  right = deep,
}: {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  top?: string;
  left?: string;
  right?: string;
}) {
  const d = w / 2;
  return (
    <g {...line} strokeWidth={5}>
      <path
        d={`M${x} ${y - d} L${x + w} ${y} L${x} ${y + d} L${x - w} ${y} Z`}
        fill={top}
        stroke={top}
      />
      <path
        d={`M${x - w} ${y} L${x} ${y + d} L${x} ${y + d + h} L${x - w} ${y + h} Z`}
        fill={left}
        stroke={left}
      />
      <path
        d={`M${x} ${y + d} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + d + h} Z`}
        fill={right}
        stroke={right}
      />
    </g>
  );
}

/** The vault: a block with a round dial on its front face. */
export function VaultArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="44" ry="9" fill={light} opacity="0.7" />
      <Block x={60} y={42} w={38} h={42} />
      <g transform="translate(79 74) skewY(-27)">
        <circle r="11" fill={paper} />
        <circle r="6.5" fill="none" stroke={deep} strokeWidth="2.5" />
        <path d="M0 -6.5 V-2" stroke={deep} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g transform="translate(41 74) skewY(27)">
        <rect x="-8" y="-3" width="16" height="6" rx="3" fill={paper} opacity="0.85" />
      </g>
    </Svg>
  );
}

/** A coin: an ellipse with a thickness band, like a disc seen at an angle. */
function Coin({
  x,
  y,
  r = 22,
  face = light,
  edge = deep,
}: {
  x: number;
  y: number;
  r?: number;
  face?: string;
  edge?: string;
}) {
  const ry = r * 0.5;
  return (
    <g>
      <path d={`M${x - r} ${y} v7 a${r} ${ry} 0 0 0 ${2 * r} 0 v-7`} fill={edge} />
      <ellipse cx={x} cy={y} rx={r} ry={ry} fill={face} />
      <ellipse
        cx={x}
        cy={y}
        rx={r * 0.62}
        ry={ry * 0.62}
        fill="none"
        stroke={mid}
        strokeWidth="2.5"
      />
    </g>
  );
}

/** A stack of coins with one more landing: the payout. */
export function CoinsArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="58" cy="100" rx="40" ry="8" fill={light} opacity="0.7" />
      <Coin x={56} y={88} />
      <Coin x={56} y={78} />
      <Coin x={56} y={68} />
      <Coin x={56} y={58} face={paper} />
      <g transform="rotate(-18 92 30)">
        <Coin x={92} y={30} r={14} face={light} />
      </g>
    </Svg>
  );
}

/** A seal with a check: a decision signed and verified. */
export function SealArt(p: P) {
  const n = 14;
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n;
    const r = i % 2 ? 34 : 39;
    return `${(60 + r * Math.cos(a)).toFixed(1)},${(56 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="36" ry="7" fill={light} opacity="0.7" />
      <polygon points={pts} fill={deep} stroke={deep} strokeWidth="4" strokeLinejoin="round" />
      <circle cx="60" cy="56" r="26" fill={mid} />
      <circle cx="60" cy="56" r="20" fill={paper} />
      <path d="M50 57 l7 7 l13 -15" stroke={deep} strokeWidth="5" {...line} />
    </Svg>
  );
}

/** A sheet with criteria bars: the rubric. */
export function RubricArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="40" ry="8" fill={light} opacity="0.7" />
      <g transform="rotate(-8 60 58)">
        <rect
          x="28"
          y="18"
          width="64"
          height="80"
          rx="10"
          fill={paper}
          stroke={mid}
          strokeWidth="3"
        />
        {[36, 54, 72].map((y, i) => (
          <g key={y}>
            <rect x="38" y={y} width="10" height="10" rx="3" fill={i < 2 ? deep : light} />
            <rect
              x="54"
              y={y + 2}
              width={[28, 22, 26][i]}
              height="6"
              rx="3"
              fill={i < 2 ? mid : light}
            />
          </g>
        ))}
      </g>
    </Svg>
  );
}

/** A link card: the work a contributor submits. */
export function LinkArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="40" ry="8" fill={light} opacity="0.7" />
      <rect
        x="18"
        y="30"
        width="84"
        height="56"
        rx="14"
        fill={paper}
        stroke={mid}
        strokeWidth="3"
      />
      <rect x="30" y="44" width="40" height="7" rx="3.5" fill={mid} />
      <rect x="30" y="58" width="56" height="6" rx="3" fill={light} />
      <rect x="30" y="70" width="34" height="6" rx="3" fill={light} />
      <g transform="translate(86 34) rotate(-30)">
        <rect
          x="-14"
          y="-6"
          width="18"
          height="12"
          rx="6"
          fill="none"
          stroke={deep}
          strokeWidth="4"
        />
        <rect
          x="-4"
          y="-6"
          width="18"
          height="12"
          rx="6"
          fill="none"
          stroke={deep}
          strokeWidth="4"
        />
      </g>
    </Svg>
  );
}

/** Too much to review: a tall, leaning stack of sheets. */
export function StackArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="40" ry="8" fill={light} opacity="0.7" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g
          key={i}
          transform={`translate(${i * 2.5} ${-i * 13}) rotate(${(i % 2 ? 4 : -3) + i})`}
          style={{ transformOrigin: "60px 90px" }}
        >
          <rect
            x="26"
            y="78"
            width="68"
            height="16"
            rx="5"
            fill={i % 2 ? light : paper}
            stroke={mid}
            strokeWidth="2.5"
          />
        </g>
      ))}
    </Svg>
  );
}

/** Farming: two near-identical cards, one a copy of the other. */
export function CopyArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="40" ry="8" fill={light} opacity="0.7" />
      <rect
        x="22"
        y="22"
        width="56"
        height="64"
        rx="12"
        fill={paper}
        stroke={mid}
        strokeWidth="3"
      />
      <rect x="32" y="36" width="30" height="6" rx="3" fill={mid} />
      <rect x="32" y="50" width="36" height="5" rx="2.5" fill={light} />
      <rect
        x="42"
        y="34"
        width="56"
        height="64"
        rx="12"
        fill={paper}
        stroke={deep}
        strokeWidth="3"
        strokeDasharray="7 6"
      />
      <rect x="52" y="48" width="30" height="6" rx="3" fill={mid} />
      <rect x="52" y="62" width="36" height="5" rx="2.5" fill={light} />
    </Svg>
  );
}

/** A black box: payouts nobody can see into. */
export function BoxArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="42" ry="8" fill={light} opacity="0.7" />
      <Block x={60} y={46} w={36} h={36} top={mid} left={deep} right={deep} />
      <path
        d="M44 38 q16 -10 32 0"
        stroke={paper}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        opacity="0.6"
      />
      <text
        x="60"
        y="52"
        textAnchor="middle"
        fontSize="16"
        fontFamily="var(--font-display)"
        fill={paper}
        fontStyle="italic"
      >
        ?
      </text>
    </Svg>
  );
}

/** A broken link: two halves of a chain link, pulled apart. For 404s. */
export function BrokenLinkArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="42" ry="8" fill={light} opacity="0.7" />
      <g transform="rotate(-24 60 60)">
        <rect
          x="10"
          y="44"
          width="44"
          height="26"
          rx="13"
          fill="none"
          stroke={deep}
          strokeWidth="9"
        />
        <rect
          x="66"
          y="44"
          width="44"
          height="26"
          rx="13"
          fill="none"
          stroke={mid}
          strokeWidth="9"
        />
      </g>
      <g stroke={mid} strokeWidth="3" {...line}>
        <path d="M56 36 l-3 -9" />
        <path d="M64 34 l3 -10" />
        <path d="M58 86 l-2 9" />
        <path d="M66 84 l4 8" />
      </g>
    </Svg>
  );
}

/** An unplugged cable: a page that couldn't reach its data. For error states. */
export function UnpluggedArt(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="60" cy="104" rx="42" ry="8" fill={light} opacity="0.7" />
      <path d="M8 74 q14 0 20 -10" stroke={mid} strokeWidth="5" fill="none" {...line} />
      <rect x="26" y="46" width="22" height="22" rx="6" fill={deep} stroke={deep} strokeWidth="2" />
      <path d="M48 52 h8 M48 62 h8" stroke={deep} strokeWidth="4" {...line} />
      <rect x="72" y="46" width="22" height="22" rx="6" fill={light} stroke={mid} strokeWidth="3" />
      <path d="M78 54 v6 M88 54 v6" stroke={mid} strokeWidth="3" {...line} />
      <path d="M94 57 q14 0 18 14" stroke={mid} strokeWidth="5" fill="none" {...line} />
      <g stroke={mid} strokeWidth="2.5" {...line}>
        <path d="M63 40 l-1 -7" />
        <path d="M66 42 l5 -5" />
        <path d="M63 74 l-1 7" />
      </g>
    </Svg>
  );
}
