import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

/** 4-second H.264 test pattern with a sine tone, built with system ffmpeg. */
function makeTestVideo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loomola-upload-e2e-"));
  const file = join(dir, "upload-e2e-clip.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    file,
  ]);
  return file;
}

test.describe("upload video from the dashboard", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("picks a file, uploads it, and lands on the edit page", async ({ page }) => {
    const video = makeTestVideo();
    expect(existsSync(video)).toBe(true);

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload video" }).first().click();
    await (await chooser).setFiles(video);

    // Progress card appears with the file name, then we land on /edit.
    await expect(page.getByRole("status")).toContainText("upload-e2e-clip.mp4");
    await page.waitForURL(/\/recordings\/[0-9a-f-]+\/edit$/, { timeout: 120_000 });
    const recordingId = page.url().match(/recordings\/([0-9a-f-]+)\/edit/)![1];

    // Title defaults to the file name without its extension.
    await expect(page.getByText("upload-e2e-clip").first()).toBeVisible();

    // Cleanup: move the test recording to the trash via the owner API.
    const res = await page.request.delete(`/api/recordings/${recordingId}`);
    expect(res.ok()).toBe(true);
  });

  test("rejects a non-video file with a toast and no navigation", async ({ page }) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload video" }).first().click();
    await (await chooser).setFiles({
      name: "notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 not a video"),
    });
    await expect(page.getByText("Only MP4, MOV, M4V or WebM videos can be uploaded.")).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("shows the drop overlay while a file is dragged over the page", async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "clip.mp4", { type: "video/mp4" }));
      document.body.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(page.getByText("Drop to upload")).toBeVisible();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "clip.mp4", { type: "video/mp4" }));
      document.body.dispatchEvent(
        new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await expect(page.getByText("Drop to upload")).toBeHidden();
  });
});
