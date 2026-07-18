import { ImageResponse } from "next/og";

import { BRAND_COLOR } from "@/lib/site-config";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const CELL = "#f4faf6";
const ACCENT = "#ff8a65";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          background: BRAND_COLOR,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            <div style={{ display: "flex", width: "8px", height: "8px", borderRadius: "2px", background: CELL }} />
            <div style={{ display: "flex", width: "8px", height: "8px", borderRadius: "2px", background: ACCENT }} />
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <div style={{ display: "flex", width: "8px", height: "8px", borderRadius: "2px", background: CELL, opacity: 0.55 }} />
            <div style={{ display: "flex", width: "8px", height: "8px", borderRadius: "2px", background: CELL }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
