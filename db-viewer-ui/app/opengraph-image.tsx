import { ImageResponse } from "next/og";

/**
 * The card a link to the site unfurls into (Slack, LinkedIn, WhatsApp, X). Generated once at
 * build time from this markup rather than kept as a PNG, so it cannot drift from the product's
 * name or colours. Next attaches it to every page as `og:image` and `twitter:image`.
 *
 * Colours are literal because there is no stylesheet here: brand blue and indigo from the
 * `@theme` block in globals.css, and the logo from app/icon.svg.
 */
export const alt = "SQL Visualizer — see your database, not just your SQL";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TABLES = [
  { name: "customers", x: 660, y: 150, cols: ["id", "name", "email"] },
  { name: "orders", x: 900, y: 260, cols: ["id", "customer_id", "total"] },
  { name: "products", x: 690, y: 390, cols: ["id", "title", "price"] },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 55%, #eef2ff 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", padding: "80px 0 0 80px", width: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#2563eb" />
              <path d="M11 14A21 6.5 0 0 1 53 14L53 26A21 6.5 0 0 1 11 26Z" fill="#fff" />
              <path d="M11 28.6A21 6.5 0 0 0 53 28.6L53 38A21 6.5 0 0 1 11 38Z" fill="#fff" />
              <path d="M11 40.6A21 6.5 0 0 0 53 40.6L53 50A21 6.5 0 0 1 11 50Z" fill="#fff" />
            </svg>
            <span style={{ fontSize: 34, fontWeight: 700, color: "#0f172a" }}>SQL Visualizer</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 56, fontSize: 64, fontWeight: 800, lineHeight: 1.08, color: "#0f172a" }}>
            <span>See your database,</span>
            <span style={{ color: "#2563eb" }}>not just your SQL</span>
          </div>
          <span style={{ marginTop: 32, fontSize: 28, lineHeight: 1.4, color: "#475569" }}>
            Drop in a .csv or .sql file and get a live, editable entity-relationship diagram.
          </span>
        </div>

        {/* Two relationship lines, drawn under the cards. */}
        <svg width="1200" height="630" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M880 205 L895 205 L895 315 L900 315" stroke="#3b82f6" strokeWidth="3" fill="none" />
          <path d="M880 445 L940 445 L940 400" stroke="#3b82f6" strokeWidth="3" fill="none" />
        </svg>

        {TABLES.map(t => (
          <div
            key={t.name}
            style={{
              position: "absolute",
              left: t.x,
              top: t.y,
              width: 220,
              display: "flex",
              flexDirection: "column",
              background: "#ffffff",
              border: "2px solid #e2e8f0",
              borderLeft: "6px solid #2563eb",
              borderRadius: 14,
              boxShadow: "0 12px 30px rgba(37, 99, 235, 0.15)",
            }}
          >
            <span style={{ padding: "12px 16px", fontSize: 22, fontWeight: 700, color: "#0f172a", borderBottom: "2px solid #f1f5f9" }}>
              {t.name}
            </span>
            {t.cols.map(c => (
              <span key={c} style={{ padding: "6px 16px", fontSize: 18, color: c === "id" ? "#b45309" : c.endsWith("_id") ? "#2563eb" : "#475569" }}>
                {c}
              </span>
            ))}
          </div>
        ))}
      </div>
    ),
    size,
  );
}
