import { describe, it, expect } from "vitest";
import { renderNewCommentEmail } from "@/lib/mail/templates/new-comment";

describe("renderNewCommentEmail", () => {
  it("includes name, timestamp (M:SS), body, and deep link in text + html", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "Demo walkthrough",
      commenterName: "Alex",
      commenterEmail: "alex@example.com",
      body: "Great pacing here.",
      timestampSec: 125,
      shareUrl: "https://loom.dissonance.cloud/v/abc123",
    });
    expect(out.text).toContain("Alex");
    expect(out.text).toContain("alex@example.com");
    expect(out.text).toContain("2:05");
    expect(out.text).toContain("Great pacing here.");
    expect(out.text).toContain("https://loom.dissonance.cloud/v/abc123#t=125");
    expect(out.html).toContain("Alex");
    expect(out.html).toContain("2:05");
    expect(out.html).toContain("Great pacing here.");
    expect(out.html).toContain("https://loom.dissonance.cloud/v/abc123#t=125");
  });

  it("formats short timestamps correctly", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "x",
      commenterName: "n",
      commenterEmail: "e@e.co",
      body: "b",
      timestampSec: 7,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.text).toContain("0:07");
    expect(out.html).toContain("0:07");
  });

  it("truncates a very long subject to <= 100 chars", () => {
    const title = "x".repeat(300);
    const out = renderNewCommentEmail({
      recordingTitle: title,
      commenterName: "n",
      commenterEmail: "e@e.co",
      body: "b",
      timestampSec: 0,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.subject.length).toBeLessThanOrEqual(100);
  });

  it("HTML-escapes < > & in body and name", () => {
    const out = renderNewCommentEmail({
      recordingTitle: "t",
      commenterName: "<script>",
      commenterEmail: "e@e.co",
      body: "a & b <img> end",
      timestampSec: 0,
      shareUrl: "https://example.com/v/x",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("a &amp; b &lt;img&gt; end");
  });
});
