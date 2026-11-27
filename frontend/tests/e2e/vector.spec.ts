// Problem 3 (onsite): vector-control scenario workstation on the Response page, against the real local API (origin 2024-08-05, h=3).
// Effects are user-set assumptions; the numbers asserted here are scenario outputs of the stated model, not measured outcomes.
import { expect, test } from "./fixtures";

const PAGE = "/response/?origin=2024-08-05&horizon=3&nointro";
const total = (box: any) => box.getByTestId("prevented-total");

test.describe("Vector-control scenarios", () => {
  test("optimized crews: prevented cases by week, supplies and hospital consequences", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#vector");
    await expect(box.getByRole("heading", { name: "Vector-control scenarios" })).toBeVisible();
    await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
    await expect(box.getByText(/Optimality check passed/)).toBeVisible();
    await box.getByRole("tab", { name: "Supplies" }).click();
    await expect(box.getByRole("tabpanel")).toContainText("1767 → 1690");
    await box.getByRole("tab", { name: "Hospital" }).click();
    await expect(box.getByRole("tabpanel")).toContainText("53 → 44");
    await box.getByRole("tab", { name: "Sources and limits" }).click();
    await expect(box.getByRole("tabpanel")).toContainText("No causal effect is estimated");
  });

  test("no crews or no effect reproduce the forecast exactly", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#vector");
    await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
    await box.getByLabel("Largest case reduction (E)").fill("0");
    await expect(total(box)).toHaveText("0.0");
    await box.getByRole("radio", { name: "Moderate" }).click();
    await expect(total(box)).toHaveText("63.2");
    await box.getByLabel("Crews available (shared)").fill("0");
    await expect(total(box)).toHaveText("0.0");
    await box.getByRole("tab", { name: "Hospital" }).click();
    await expect(box.getByRole("tabpanel")).toContainText("53 → 53");
    await expect(page.locator("#supply").getByText("of 0 available; 110 needed")).toBeVisible();   // the crew budget is shared with Supply allocation
  });

  test("manual deployment starts from the optimized plan, respects the budget and reports a worse plan honestly", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#vector");
    await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
    await box.getByRole("radio", { name: "Manual" }).click();
    await expect(box.getByText("0 of 20 crews left to place.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Add a crew to CCC_Ward_03" })).toBeDisabled();       // budget used up
    await box.getByRole("button", { name: "Remove a crew from CCC_Ward_03" }).click();
    await expect(box.getByText("1 of 20 crews left to place.")).toBeVisible();
    await box.getByRole("button", { name: "Add a crew to DSCC_Ward_04" }).click();                    // a second crew is worth less than a first
    await expect(box.getByText(/This plan can be improved/)).toBeVisible();
    const v = Number(await total(box).innerText());
    expect(v).toBeLessThan(63.2);
  });

  test("an in-sample forecast is refused", async ({ page }) => {
    await page.goto("/response/?origin=2024-08-05&horizon=3&source=bundle&nointro");
    await expect(page.locator("#vector").getByText("This plan needs an out-of-time forecast.")).toBeVisible();
  });

  for (const theme of ["light", "dim"]) {
    test(`every workstation tab has no serious or critical axe violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("ds.theme", t), theme);
      await page.goto(PAGE);
      const box = page.locator("#vector");
      await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
      await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });   // same test-only source as app.spec
      for (const tab of ["Crew plan and ROI", "Supplies", "Hospital", "Sensitivity", "Sources and limits"]) {
        await box.getByRole("tab", { name: tab }).click();
        await page.waitForTimeout(400);
        const res: any = await page.evaluate(async () => (window as any).axe.run("#vector", { runOnly: ["wcag2a", "wcag2aa"] }));
        const bad = res.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious").map((v: any) => `${tab}: ${v.id} ${v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")).join(" | ")}`);
        expect(bad).toEqual([]);
      }
    });
  }

  for (const w of [360, 390]) {
    test(`at ${w}px the workstation fits and manual steppers work`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 860 });
      await page.goto(PAGE);
      const box = page.locator("#vector");
      await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
      await box.getByRole("radio", { name: "Manual" }).click();
      await box.getByRole("button", { name: "Remove a crew from CCC_Ward_03" }).click();
      await expect(box.getByText("1 of 20 crews left to place.")).toBeVisible();
      const bb = await box.getByRole("button", { name: "Add a crew to CCC_Ward_03" }).boundingBox();
      expect(bb!.width).toBeGreaterThanOrEqual(44);                                                 // touch target
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    });
  }
});
