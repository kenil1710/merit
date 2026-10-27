import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  // The in-memory test database (MERIT_DB=pglite) loads its pg_trgm extension from disk; bundled into a page it
  // can't find it. Production never takes that branch.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Committed seed records (round 1's judgement and campaign brief).
  outputFileTracingIncludes: { "/**": ["./data/**/*.json"], "/opengraph-image": ["./assets/fonts/*.woff"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
