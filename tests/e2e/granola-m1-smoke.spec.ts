import { expect, test } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("Granola M1 schema foundations smoke", () => {
  test.skip(
    !TEST_EMAIL ||
      !TEST_PASSWORD ||
      process.env.ENABLE_GRANOLA !== "true",
    "requires TEST_CREATOR_EMAIL, TEST_CREATOR_PASSWORD, and ENABLE_GRANOLA=true"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("people CRUD round-trip via API", async ({ page }) => {
    const createResp = await page.request.post("/api/people", {
      data: { displayName: "M1 Smoke Person", email: "smoke@example.com" },
    });
    expect(createResp.ok()).toBe(true);
    const created: { id: string; displayName: string } = await createResp.json();
    expect(created.displayName).toBe("M1 Smoke Person");

    try {
      const listResp = await page.request.get("/api/people");
      expect(listResp.ok()).toBe(true);
      const list: Array<{ id: string }> = await listResp.json();
      expect(list.find((person) => person.id === created.id)).toBeTruthy();

      const patchResp = await page.request.patch(`/api/people/${created.id}`, {
        data: { displayName: "M1 Smoke Renamed" },
      });
      expect(patchResp.ok()).toBe(true);
      const patched: { displayName: string } = await patchResp.json();
      expect(patched.displayName).toBe("M1 Smoke Renamed");
    } finally {
      await page.request.delete(`/api/people/${created.id}`);
    }
  });

  test("dictionary terms CRUD round-trip via API", async ({ page }) => {
    const term = `M1Smoke-${Date.now()}`;
    const createResp = await page.request.post("/api/dictionary-terms", {
      data: { term },
    });
    expect(createResp.ok()).toBe(true);
    const created: { id: string; term: string } = await createResp.json();
    expect(created.term).toBe(term);

    try {
      const listResp = await page.request.get("/api/dictionary-terms");
      expect(listResp.ok()).toBe(true);
      const list: Array<{ id: string; term: string }> = await listResp.json();
      expect(list.find((row) => row.id === created.id)).toBeTruthy();
    } finally {
      await page.request.delete(`/api/dictionary-terms/${created.id}`);
    }
  });
});
