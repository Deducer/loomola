import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // pg-boss + its pg dependency use dynamic requires that webpack can't
  // statically analyse. ffmpeg-static resolves its binary path relative to
  // its own __dirname, which breaks when webpack bundles it into a chunk.
  // Tell Next.js to leave these as plain require() calls at runtime.
  serverExternalPackages: ["pg-boss", "pg", "pg-native", "ffmpeg-static"],
};

export default nextConfig;
