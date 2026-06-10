import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "@/lib/mail/mailgun";

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
});

describe("optional email", () => {
  it("isEmailConfigured is false when any Mailgun var is missing", () => {
    delete process.env.MAILGUN_API_KEY;
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAIL_FROM_ADDRESS = "x@example.com";
    expect(isEmailConfigured()).toBe(false);
  });

  it("sendEmail no-ops (no fetch, no throw) when unconfigured", async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.MAIL_FROM_ADDRESS;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      sendEmail({ to: "a@b.c", subject: "s", text: "t", html: "<p>t</p>" })
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
