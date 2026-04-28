import type { NextConfig } from "next";

// Baked at build time so the running app can show the user which build
// they're looking at. Inlined into the client bundle via NEXT_PUBLIC_*.
// Coolify rebuilds on every push, so the timestamp changes per deploy.
const buildTime = new Date().toISOString();

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  // pg-boss + its pg dependency use dynamic requires that webpack can't
  // statically analyse. Tell Next.js to leave them as plain require() calls
  // at runtime (server-side only).
  serverExternalPackages: ["pg-boss", "pg", "pg-native"],
};

export default nextConfig;
