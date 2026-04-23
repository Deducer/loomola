import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("recording capture flow", () => {
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

  test("idle form renders with bubble preview", async ({ page }) => {
    await page.goto("/record");
    await expect(page.getByRole("heading", { name: "New recording" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
    // Canvas preview element renders
    const canvases = page.locator("canvas");
    await expect(canvases.first()).toBeVisible();
  });

  // Full state machine coverage is gated behind Chromium's ability to
  // auto-accept getDisplayMedia() prompts. The --auto-accept-this-tab-capture
  // flag only works for tab-capture in recent Chromium versions; our code
  // uses getDisplayMedia() for arbitrary display capture which still shows
  // a picker even with fake UI. Manual 4K stress test (see plan Task 18)
  // covers the capture pipeline end-to-end.
});
