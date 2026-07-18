import { ImageResponse } from "next/og";

import { BRAND_COLOR } from "@/lib/site-config";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const CELL = "#f4faf6";
const ACCENT = "#ff8a65";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLOR,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", gap: "22px" }}>
            <div style={{ display: "flex", width: "44px", height: "44px", borderRadius: "12px", background: CELL }} />
            <div style={{ display: "flex", width: "44px", height: "44px", borderRadius: "12px", background: ACCENT }} />
          </div>
          <div style={{ display: "flex", gap: "22px" }}>
            <div style={{ display: "flex", width: "44px", height: "44px", borderRadius: "12px", background: CELL, opacity: 0.55 }} />
            <div style={{ display: "flex", width: "44px", height: "44px", borderRadius: "12px", background: CELL }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
