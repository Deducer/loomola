import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("/recordings/[id]/edit", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test("anon redirects to login", async ({ page }) => {
    await page.goto(
      "/recordings/00000000-0000-0000-0000-000000000000/edit"
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("owner sees the edit shell on a real recording", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    const cardWithId = page.locator("[data-recording-id]").first();
    await expect(cardWithId).toBeVisible();
    const id = await cardWithId.getAttribute("data-recording-id");
    expect(id).toBeTruthy();

    await page.goto(`/recordings/${id}/edit`);
    await expect(
      page.getByRole("link", { name: /Dashboard/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /View public page/i })
    ).toBeVisible();
    await expect(page.getByText(/Status:/)).toBeVisible();
  });

  test("non-owner gets 404", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    const res = await page.goto(
      "/recordings/11111111-2222-3333-4444-555555555555/edit"
    );
    expect(res?.status()).toBe(404);
  });
});
