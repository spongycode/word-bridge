import { ImageResponse } from "next/og";

// Home-screen icon for iOS (needs PNG); same bridge mark as app/icon.svg
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#09090b" }}>
        <svg width="140" height="140" viewBox="0 0 64 64" fill="none" stroke="#a78bfa" strokeLinecap="round">
          <path d="M10 44 Q32 8 54 44" strokeWidth="6" />
          <path d="M10 44 V50 M54 44 V50 M21 33 V44 M32 27 V44 M43 33 V44" strokeWidth="4" opacity="0.7" />
        </svg>
      </div>
    ),
    size
  );
}
