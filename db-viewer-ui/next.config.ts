import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

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
