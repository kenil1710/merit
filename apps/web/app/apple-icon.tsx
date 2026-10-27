import { ImageResponse } from "next/og";
import { CHECK_PATH, HEX_PATH } from "@/components/brand/wordmark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#E8E3D8" }}>
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
        <path d={HEX_PATH} stroke="#151515" strokeWidth="1.8" strokeLinejoin="round" />
        <path d={CHECK_PATH} stroke="#151515" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>,
    size,
  );
}
