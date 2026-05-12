import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Baked at build time so the running app can show the user which build
// they're looking at. Inlined into the client bundle via NEXT_PUBLIC_*.
// Coolify rebuilds on every push, so the timestamp changes per deploy.
const buildTime = new Date().toISOString();
const buildCommit =
  process.env.NEXT_PUBLIC_BUILD_COMMIT ||
  process.env.SOURCE_COMMIT ||
  process.env.COOLIFY_GIT_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  readGitCommit();

function readGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // 4 MB is enough headroom for a 2 MB logo upload (with multipart
    // overhead) plus all the brand-form text fields.
    serverActions: { bodySizeLimit: "4mb" },
  },
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
  },
  // pg-boss + its pg dependency use dynamic requires that webpack can't
  // statically analyse. Tell Next.js to leave them as plain require() calls
  // at runtime (server-side only).
  serverExternalPackages: ["pg-boss", "pg", "pg-native"],
};

export default nextConfig;
