import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // Local mutable databases are runtime data, never deployment artifacts.
  outputFileTracingExcludes: { "/*": ["./.data/**/*"] },
  poweredByHeader: false,
};
export default config;
