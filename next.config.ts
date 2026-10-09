import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // Local mutable databases are runtime data, never deployment artifacts.
  outputFileTracingExcludes: { "/*": ["./.data/**/*"] },
  poweredByHeader: false,
  async headers() {
    return ["/review-link/:path*", "/api/approvals/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    }));
  },
};
export default config;
