export default {
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
};
