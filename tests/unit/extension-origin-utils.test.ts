import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_ORIGIN,
  normalizeAppOrigin,
  originToMatchPattern,
} from "../../extension/lib/origin-utils.js";

describe("normalizeAppOrigin", () => {
  it("normalizes bare domains to https origins and strips paths", () => {
    expect(normalizeAppOrigin("loomola.example.com")).toBe(
      "https://loomola.example.com"
    );
    expect(normalizeAppOrigin("  https://loomola.example.com/record  ")).toBe(
      "https://loomola.example.com"
    );
  });

  it("keeps explicit ports in the origin", () => {
    expect(normalizeAppOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000"
    );
  });

  it("allows http only for loopback hosts", () => {
    expect(normalizeAppOrigin("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000"
    );
    expect(normalizeAppOrigin("http://loomola.example.com")).toBeNull();
  });

  it("rejects junk without throwing", () => {
    expect(normalizeAppOrigin("")).toBeNull();
    expect(normalizeAppOrigin("   ")).toBeNull();
    expect(normalizeAppOrigin("chrome://extensions")).toBeNull();
    expect(normalizeAppOrigin(null)).toBeNull();
    expect(normalizeAppOrigin(42)).toBeNull();
    expect(normalizeAppOrigin("not a url !!")).toBeNull();
  });

  it("default origin remains Ian's instance", () => {
    expect(DEFAULT_APP_ORIGIN).toBe("https://loom.dissonance.cloud");
  });
});

describe("originToMatchPattern", () => {
  it("appends /* to a plain origin", () => {
    expect(originToMatchPattern("https://loom.dissonance.cloud")).toBe(
      "https://loom.dissonance.cloud/*"
    );
  });

  it("strips ports — Chrome match patterns cannot contain them (and match any port)", () => {
    expect(originToMatchPattern("http://localhost:3000")).toBe(
      "http://localhost/*"
    );
  });
});
