import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BlobField, CORNER_LABEL } from "@/components/brand/blobs";
import { CHECK_PATH, HEX_PATH } from "@/components/brand/wordmark";

export const alt = "Merit: pay for real work, verified by Rialo validators and paid on-chain.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(path.join(process.cwd(), "assets/fonts", file));

export default async function OpengraphImage() {
  const [semibold, bold, mono] = await Promise.all([
    font("inter-tight-latin-600-normal.woff"),
    font("inter-tight-latin-700-normal.woff"),
    font("ibm-plex-mono-latin-400-normal.woff"),
  ]);
  const ink = "#151515";
  const muted = "#6B675F";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#E8E3D8", color: ink, fontFamily: "Inter Tight" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 56px 72px", width: 660 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
            <path d={HEX_PATH} stroke={ink} strokeWidth="1.9" strokeLinejoin="round" />
            <path d={CHECK_PATH} stroke={ink} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>Merit</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-0.035em" }}>
            <div style={{ display: "flex" }}>
              <span style={{ marginRight: 22 }}>Pay</span>
              <span style={{ marginRight: 22 }}>for</span>
              <span style={{ fontWeight: 700 }}>real</span>
            </div>
            <div style={{ display: "flex" }}>
              <span>work.</span>
            </div>
          </div>
          <div style={{ marginTop: 22, fontSize: 28, fontWeight: 600, color: muted, lineHeight: 1.3, letterSpacing: "-0.01em", maxWidth: 560 }}>
            An AI judge scores it, Rialo validators verify it, and the round pays itself.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "IBM Plex Mono", fontSize: 18, lineHeight: 1.5 }}>
          {CORNER_LABEL.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 540, paddingRight: 48 }}>
        {BlobField({ ink, width: 492, height: 400 })}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter Tight", data: semibold, weight: 600, style: "normal" },
        { name: "Inter Tight", data: bold, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
