import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/unit/bubble-shapes.test.ts", "happy-dom"],
    ],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
