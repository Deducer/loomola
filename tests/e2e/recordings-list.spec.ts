import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("recordings dashboard", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test("dashboard renders list or empty state", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Recordings" })).toBeVisible();
    // Either the empty-state message OR at least one recording card should be visible
    const empty = page.getByText("No recordings yet.");
    const cards = page.locator('a[href^="/v/"]');
    await expect(async () => {
      const emptyVisible = await empty.isVisible().catch(() => false);
      const cardCount = await cards.count();
      expect(emptyVisible || cardCount > 0).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
