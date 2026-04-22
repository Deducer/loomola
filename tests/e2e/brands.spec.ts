import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("brand profiles CRUD", () => {
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

  test("create, edit, and delete a brand profile", async ({ page }) => {
    const uniqueName = `E2E Brand ${Date.now()}`;

    // Navigate to brands list
    await page.getByRole("link", { name: "Brands" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByRole("heading", { name: "Brands" })).toBeVisible();

    // Create
    await page.getByRole("link", { name: "New brand" }).click();
    await expect(page).toHaveURL("/brands/new");
    await page.getByLabel("Name").fill(uniqueName);
    await page.getByLabel("Accent color").fill("#FF6B35");
    await page.getByRole("button", { name: "Create brand" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(uniqueName)).toBeVisible();

    // Edit
    await page.getByText(uniqueName).click();
    await page.waitForURL(/\/brands\/[0-9a-f-]+$/);
    const editedName = `${uniqueName} edited`;
    await page.getByLabel("Name").fill(editedName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(editedName)).toBeVisible();

    // Delete
    await page.getByText(editedName).click();
    await page.waitForURL(/\/brands\/[0-9a-f-]+$/);
    await page.getByRole("button", { name: "Delete brand profile" }).click();
    await expect(page).toHaveURL("/brands");
    await expect(page.getByText(editedName)).not.toBeVisible();
  });

  test("rejects invalid accent color", async ({ page }) => {
    await page.goto("/brands/new");
    await page.getByLabel("Name").fill("Invalid color test");
    await page.getByLabel("Accent color").fill("orange");
    await page.getByRole("button", { name: "Create brand" }).click();
    // Stays on the form with an error shown
    await expect(page).toHaveURL("/brands/new");
    await expect(
      page.getByText(/Accent color must be a hex code/)
    ).toBeVisible();
  });
});
