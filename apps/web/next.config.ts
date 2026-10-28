import type { NextConfig } from "next";

// Defense in depth for the in-browser wallet: scripts, styles and fonts only from this site, and every fetch (the
// relay included) back to this site, so injected script can't load code or send a typed passphrase elsewhere. Next's
// inline bootstrap needs 'unsafe-inline' without nonces; the wallet's crypto needs WebAssembly. `next dev` also needs
// eval, so the policy applies to production builds.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://x.com https://twitter.com",
  "object-src 'none'",
].join("; ");

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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
        ],
      },
    ];
  },
};

export default config;
