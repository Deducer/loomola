import { describe, expect, it } from "vitest";
import { isDeepgramPaymentRequiredError } from "@/lib/deepgram/errors";

describe("isDeepgramPaymentRequiredError", () => {
  it("detects Deepgram 402 status shapes", () => {
    expect(isDeepgramPaymentRequiredError({ status: 402 })).toBe(true);
    expect(isDeepgramPaymentRequiredError({ response: { status: 402 } })).toBe(
      true
    );
  });

  it("detects Deepgram ASR payment messages", () => {
    expect(
      isDeepgramPaymentRequiredError({
        message:
          "ASR_PAYMENT_REQUIRED: Project does not have enough credits for an ASR request",
      })
    ).toBe(true);
  });

  it("ignores unrelated Deepgram errors", () => {
    expect(isDeepgramPaymentRequiredError({ status: 429 })).toBe(false);
    expect(isDeepgramPaymentRequiredError(new Error("network timeout"))).toBe(
      false
    );
  });
});
