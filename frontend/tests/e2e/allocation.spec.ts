// Problem 1 (onsite): supply allocation on the Response page. Numbers come from the real local API (origin 2024-08-05, 3 weeks ahead).
import { expect, test } from "./fixtures";

const PAGE = "/response/?origin=2024-08-05&horizon=3&nointro";

test.describe("Supply allocation", () => {
  test("shows demand, supply and shortfall, flags critical wards, and recomputes when stock changes", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#supply");
    await expect(box.getByRole("heading", { name: "Supply allocation" })).toBeVisible();
    await expect(box.getByText("of 1767 needed; supply 1059; short 708")).toBeVisible({ timeout: 30_000 });   // saline at 60% stock, upper 80%
    await expect(box.getByRole("alert")).toContainText("Critical supply deficit in 39 wards");
    await expect(box.getByRole("cell", { name: /DSCC_Ward_04/ }).first()).toBeVisible();                       // top priority ward

    const plan = page.waitForResponse((r) => r.url().includes("/api/allocation/plan") && r.url().includes("stock=1"));
    await box.getByLabel("Regional stock").fill("100");
    await plan;
    await expect(box.getByText("Every ward in view is fully supplied at 100% stock.")).toBeVisible();
    await expect(box.getByRole("alert")).toHaveCount(0);
  });

  test("a city filter keeps the plan to that city", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#supply");
    await box.getByLabel("City").selectOption("Gazipur");
    await expect(box.getByText("Gazipur only")).toBeVisible({ timeout: 30_000 });
    await expect(box.getByRole("cell", { name: /DNCC_Ward_/ })).toHaveCount(0);
  });

  test("a 2025 forecast origin is refused and offers the last 2024 origin", async ({ page }) => {
    let called = false;
    page.on("request", (r) => { if (r.url().includes("/api/allocation/plan") && r.url().includes("origin=2025")) called = true; });
    await page.goto("/response/?origin=2025-03-03&horizon=3&nointro");
    const box = page.locator("#supply");
    await expect(box.getByText("Allocation uses forecasts issued in 2024 or earlier.")).toBeVisible();
    await box.getByRole("button", { name: /Use the forecast issued/ }).click();
    await expect(box.getByText(/for the week of/)).toBeVisible({ timeout: 30_000 });
    expect(called).toBe(false);
  });

  test("at 390px the section fits the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto(PAGE);
    await expect(page.locator("#supply").getByText(/of 1767 needed/)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
