import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // pg-boss + its pg dependency use dynamic requires that webpack can't
  // statically analyse. Tell Next.js to leave them as plain require() calls
  // at runtime (server-side only).
  serverExternalPackages: ["pg-boss", "pg", "pg-native"],
};

export default nextConfig;
