import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { SITE_NAME, SITE_TAGLINE } from "@/lib/site-config";

// Split at the comma so the OG card controls its own line breaks instead of
// relying on satori's character-boundary wrapping, which breaks mid-word for Hangul.
const [taglineFirst, taglineRest] = SITE_TAGLINE.split(/,\s*/);
const TAGLINE_LINES = [`${taglineFirst},`, taglineRest];

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0f2a1f";
const INK = "#f4faf6";
const MUTED = "#8fc9ac";
const BLOCK_COLORS = ["#176a4c", "#ff8a65", "#ffc857", "#7bd9c0", "#8ecae6"];

const ROWS: { day: string; start: number; width: number; color: string }[] = [
  { day: "월", start: 26, width: 210, color: BLOCK_COLORS[1] },
  { day: "화", start: 58, width: 150, color: BLOCK_COLORS[3] },
  { day: "수", start: 20, width: 240, color: BLOCK_COLORS[0] },
  { day: "목", start: 44, width: 175, color: BLOCK_COLORS[4] },
  { day: "금", start: 34, width: 195, color: BLOCK_COLORS[2] },
];

export default async function Image() {
  const fontPath = path.join(process.cwd(), "src/app/assets/fonts/BlackHanSans-Regular.ttf");
  const headlineFont = await readFile(fontPath);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: BG,
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-220px",
            right: "-120px",
            width: "520px",
            height: "520px",
            borderRadius: "9999px",
            background: "rgba(23,106,76,0.3)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "26px",
            width: "620px",
            height: "100%",
            padding: "0 0 0 80px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: MUTED,
            }}
          >
            SKKU TIMETABLE
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Black Han Sans",
              fontSize: 62,
              lineHeight: 1.3,
              color: INK,
            }}
          >
            {TAGLINE_LINES.map((line) => (
              <div key={line} style={{ display: "flex" }}>
                {line}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 600,
              color: MUTED,
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: "-30px",
            top: "78px",
            width: "470px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            padding: "30px",
            borderRadius: "26px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.16)",
            boxShadow: "0 50px 90px rgba(0,0,0,0.4)",
            transform: "rotate(-6deg)",
          }}
        >
          {ROWS.map((row) => (
            <div
              key={row.day}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.12)",
                  color: MUTED,
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {row.day}
              </div>
              <div
                style={{
                  display: "flex",
                  marginLeft: `${row.start}px`,
                  width: `${row.width}px`,
                  height: "22px",
                  borderRadius: "8px",
                  background: row.color,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Black Han Sans", data: headlineFont, weight: 400, style: "normal" }],
    },
  );
}
