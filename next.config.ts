import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// React's development build calls `eval()` for its prop-validation helpers, so a
// CSP without `'unsafe-eval'` makes `next dev` serve a page that never hydrates:
// the login form silently degrades to a native GET submit and every button stops
// working. The relaxation is dev-only — production keeps the strict policy and
// ships no eval use — and is pinned by tests/unit/next-config.test.ts.
const scriptSrc = isProduction
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Next.js App Router requires 'unsafe-inline' for hydration payloads; the
  // remaining directives still meaningfully shrink XSS/clickjacking surface.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // RS-04: the Playwright harness points this at `.next-e2e` so its dev server
  // cannot share — or be poisoned by — the developer's compiled graph. A turbopack
  // cache left by a hard-killed dev server serves pages that never hydrate, and that
  // showed up as an unexplained login failure in the matrix. Unset means `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev-only, and the second way a `next dev` page can render but never hydrate:
  // Next 16 rejects cross-origin requests for dev bundles and the HMR socket, so an
  // app opened over an IP address (127.0.0.1 here, or a LAN address when checking the
  // responsive layout on a phone) stays dead. `allowedDevOrigins` is ignored in a
  // production build; set DEV_ALLOWED_ORIGINS="192.168.1.20,myhost.local" to add more.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.DEV_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
