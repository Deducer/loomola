import { describe, expect, it } from "vitest";
import { describeAiFailure } from "@/lib/ai/with-fallback";

describe("describeAiFailure", () => {
  it("names auth failures", () => {
    expect(describeAiFailure({ statusCode: 401, message: "invalid x-api-key" })).toBe(
      "AI generation failed: the AI provider rejected the API key"
    );
    expect(describeAiFailure({ statusCode: 403 })).toBe(
      "AI generation failed: the AI provider rejected the API key"
    );
  });

  it("names credit exhaustion by status code or message", () => {
    expect(describeAiFailure({ statusCode: 402 })).toBe(
      "AI generation failed: the AI provider account is out of credits"
    );
    expect(
      describeAiFailure({ statusCode: 400, message: "Your credit balance is too low" })
    ).toBe("AI generation failed: the AI provider account is out of credits");
  });

  it("names rate limits", () => {
    expect(describeAiFailure({ statusCode: 429 })).toBe(
      "AI generation failed: AI provider rate limit"
    );
  });

  it("falls back to a truncated error message", () => {
    expect(describeAiFailure(new Error("boom"))).toBe("AI generation failed: boom");
    const long = "x".repeat(300);
    expect(describeAiFailure(new Error(long)).length).toBeLessThanOrEqual(
      "AI generation failed: ".length + 200
    );
  });

  it("never throws on junk input", () => {
    expect(describeAiFailure(null)).toBe("AI generation failed");
    expect(describeAiFailure(undefined)).toBe("AI generation failed");
    expect(describeAiFailure("string error")).toBe("AI generation failed");
  });
});
