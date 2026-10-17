import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The test copy builds into its own folder so it can run beside the real server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PGlite loads its own WASM files at runtime; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "playwright-core"],
  poweredByHeader: false,
  experimental: {
    // Ads Manager screenshots: up to 20 images of 10 MB each in one save, plus form overhead.
    serverActions: { bodySizeLimit: "210mb" },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // Same site only: the check page shows the report page in a frame; no other site may.
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
};

export default nextConfig;
