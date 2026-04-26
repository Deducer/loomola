import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

async function signInAndGoToShareUrl(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL!);
  await page.getByLabel("Password").fill(TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  // Click first recording card → lands on /recordings/{id}/edit
  const firstCard = page.locator("[data-recording-id]").first();
  await expect(firstCard).toBeVisible();
  await firstCard.locator("a").first().click();
  await expect(page).toHaveURL(/\/recordings\/[^/]+\/edit/);

  // Read the share URL from the edit page's <code> element
  const shareCode = page.locator("code").filter({ hasText: "/v/" }).first();
  await expect(shareCode).toBeVisible();
  const shareUrl = await shareCode.textContent();
  expect(shareUrl).toBeTruthy();
  const slugMatch = shareUrl!.match(/\/v\/([^/?#]+)/);
  expect(slugMatch).toBeTruthy();
  const slug = slugMatch![1];

  await page.goto(`/v/${slug}`);
}

test.describe("/v/:slug share page", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test("renders title, player, and tabs default to Transcript", async ({
    page,
  }) => {
    await signInAndGoToShareUrl(page);

    // Header
    await expect(page.locator("h1")).toBeVisible();
    // Player
    await expect(page.locator("video")).toBeVisible();
    // Tabs default to Transcript
    const transcriptTab = page.getByRole("tab", { name: "Transcript" });
    const commentsTab = page.getByRole("tab", { name: "Comments" });
    await expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    await expect(commentsTab).toHaveAttribute("aria-selected", "false");

    // Click Comments → URL updates to ?tab=comments and panel switches
    await commentsTab.click();
    await expect(commentsTab).toHaveAttribute("aria-selected", "true");
    expect(page.url()).toContain("tab=comments");
  });

  test("owner sees Edit pill in brand header", async ({ page }) => {
    await signInAndGoToShareUrl(page);
    await expect(page.getByRole("link", { name: /Edit/ })).toBeVisible();
  });
});
