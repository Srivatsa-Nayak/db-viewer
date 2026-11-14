import type { NextConfig } from "next";

/** The backend's origin, the only other place this UI talks to. */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").origin;
  } catch {
    return "";
  }
})();

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy, **enforced**. Next.js inlines its bootstrap scripts, so
 * `'unsafe-inline'` is needed without per-request nonces; what the policy buys is `connect-src`,
 * which limits where a script could send the session token in localStorage — this origin and
 * the API — plus no plugins, no foreign scripts, styles, fonts or images, and no framing.
 * The PNG export renders through `data:` and `blob:` images and fetches its fonts from this
 * origin, which is why those are allowed. The Playwright smoke test (e2e/) fails on any
 * violation, including during an export. `'unsafe-eval'` is for the dev server's React tooling
 * only.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The CSP's frame-ancestors says the same; this covers browsers that predate it.
  { key: "X-Frame-Options", value: "DENY" },
  // Full URLs within the site, only the origin to other sites. A share link carries its token
  // in the path, and it should not travel to whatever site the viewer clicks through to.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  output: "standalone",

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  // Nothing gains from advertising the framework, and it is one header on every response.
  poweredByHeader: false,

  // Strip `console.log` from production builds but keep `console.error` / `console.warn`,
  // which the restore and refresh paths rely on to report a failure they deliberately
  // swallow rather than surface.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },

  experimental: {
    /**
     * Rewrites `import { Database } from 'lucide-react'` into per-icon deep imports.
     *
     * lucide-react is a barrel over a thousand-odd icon modules; without this, a page that
     * uses six icons still pulls the barrel into its module graph. `reactflow` is the same
     * shape — a barrel re-exporting the whole library from one entry point.
     */
    optimizePackageImports: ["lucide-react", "reactflow"],
  },
};

export default nextConfig;
