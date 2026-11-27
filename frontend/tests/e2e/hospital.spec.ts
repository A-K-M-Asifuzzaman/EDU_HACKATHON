// Problem 2 (onsite): hospital surge and cross-ward overflow on the Response page, against the real local API (origin 2024-08-05, h=3).
import { expect, test } from "./fixtures";

const PAGE = "/response/?origin=2024-08-05&horizon=3&nointro";

test.describe("Hospital surge", () => {
  test("the peak is a city-wide surge: shortage reported, no ward can help, a surge scenario moves patients inside cities", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#surge");
    await expect(box.getByRole("heading", { name: "Hospital surge and overflow" })).toBeVisible();
    await expect(box.getByRole("alert")).toContainText("53 projected patients without a bed in their own city", { timeout: 30_000 });
    await expect(box.getByRole("alert")).toContainText("the surge is city-wide");
    await box.getByRole("radio", { name: "+20% surge beds" }).click();
    await expect(box.getByRole("alert")).toContainText("16 projected patients without a bed in their own city");
    const rows = box.getByRole("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(9);
    for (const r of await rows.all()) {                                                   // every transfer stays inside one city
      const [, from, to] = (await r.locator("td").allInnerTexts()).map((x) => x.trim());
      expect(from.split("_")[0]).toBe(to.split("_")[0]);
    }
  });

  test("a typed ward capacity recomputes the plan and can be cleared", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#surge");
    await box.getByLabel("City", { exact: true }).selectOption("Gazipur");
    await expect(box.getByRole("alert")).toContainText("5 projected patients", { timeout: 30_000 });
    await box.getByLabel("Capacity for GCC_Ward_04").fill("9");
    await expect(box.getByRole("status").filter({ hasText: "Every projected patient has a bed in their own city, after 4 transfers" })).toBeVisible();
    await expect(box.getByText("typed", { exact: true })).toHaveCount(1);
    await box.getByRole("button", { name: /Clear 1 typed capacity/ }).click();
    await expect(box.getByRole("alert")).toContainText("5 projected patients");
  });

  test("the service level is shared with supply allocation", async ({ page }) => {
    await page.goto(PAGE);
    await page.locator("#surge").getByRole("radio", { name: "Median" }).click();
    await expect(page.locator("#supply").getByText(/planned at the median forecast/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#surge").getByText(/for the week of .* at the median forecast/)).toBeVisible();
  });

  test("an in-sample forecast is labelled and refused, with a one-click switch to the validated replay", async ({ page }) => {
    let called = false;
    page.on("request", (r) => { if (/\/api\/(overflow|allocation)\/plan/.test(r.url()) && r.url().includes("source=bundle")) called = true; });
    await page.goto("/response/?origin=2024-08-05&horizon=3&source=bundle&nointro");
    await expect(page.getByTestId("provenance-warning")).toContainText("Not an out-of-time forecast.");
    const box = page.locator("#surge");
    await expect(box.getByText("This plan needs an out-of-time forecast.")).toBeVisible();
    await box.getByRole("button", { name: "Use the validated replay" }).click();
    await expect(box.getByRole("alert")).toContainText("53 projected patients", { timeout: 30_000 });
    await expect(page.getByTestId("provenance-warning")).toHaveCount(0);
    expect(called).toBe(false);
  });

  for (const w of [360, 390]) {
    test(`at ${w}px the section fits the screen`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 860 });
      await page.goto(PAGE);
      const box = page.locator("#surge");
      await expect(box.getByRole("alert")).toBeVisible({ timeout: 30_000 });
      await box.getByRole("radio", { name: "+20% surge beds" }).click();
      await expect(box.getByText("Transfer assignments")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    });
  }
});
