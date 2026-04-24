import { describe, it, expect } from "vitest";
import { validateTrim } from "@/lib/viewer/trim-validate";

describe("validateTrim", () => {
  it("accepts a simple valid trim", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 10, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("accepts the full boundary (start=0, end=duration)", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 15, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("accepts endSec slightly over duration within 0.5s tolerance", () => {
    expect(
      validateTrim({ startSec: 0, endSec: 15.3, durationSec: 15 })
    ).toEqual({ ok: true });
  });

  it("rejects a negative start", () => {
    expect(validateTrim({ startSec: -0.1, endSec: 5, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_negative",
    });
  });

  it("rejects an end beyond duration + tolerance", () => {
    expect(validateTrim({ startSec: 0, endSec: 16, durationSec: 15 })).toEqual({
      ok: false,
      error: "end_out_of_bounds",
    });
  });

  it("rejects equal start and end", () => {
    expect(validateTrim({ startSec: 5, endSec: 5, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_ge_end",
    });
  });

  it("rejects start greater than end", () => {
    expect(validateTrim({ startSec: 8, endSec: 3, durationSec: 15 })).toEqual({
      ok: false,
      error: "start_ge_end",
    });
  });
});
