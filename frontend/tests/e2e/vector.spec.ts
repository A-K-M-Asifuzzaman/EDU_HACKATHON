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
    await expect(box.getByTestId("crews-by-city")).toContainText("Chattogram");                       // transparent city totals of the shared budget
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

  test("decision sections stay idle when nothing changes (no re-render loop)", async ({ page }) => {
    await page.goto(PAGE);
    await expect(total(page.locator("#vector"))).toHaveText("63.2", { timeout: 30_000 });
    await expect(page.locator("#dispatch").getByTestId("sms-text")).toContainText("Ref S-", { timeout: 30_000 });
    await page.waitForTimeout(1000);
    const changes = await page.evaluate(() => new Promise<Record<string, number>>((res) => {
      const out: Record<string, number> = { supply: 0, surge: 0, vector: 0, dispatch: 0 };
      for (const id of Object.keys(out)) new MutationObserver((ms) => { out[id] += ms.length; })
        .observe(document.getElementById(id)!, { subtree: true, attributes: true, childList: true, characterData: true });
      setTimeout(() => res(out), 3000);
    }));
    expect(changes).toEqual({ supply: 0, surge: 0, vector: 0, dispatch: 0 });
  });

  test("a slow server still settles: manual crews with a 600 ms simulator response", async ({ page }) => {
    await page.route(/\/api\/intervention\/simulate/, async (r) => { await new Promise((x) => setTimeout(x, 600)); await r.continue(); });
    await page.goto(PAGE);
    const box = page.locator("#vector");
    await expect(total(box)).toHaveText("63.2", { timeout: 30_000 });
    await box.getByRole("radio", { name: "Manual" }).click();
    await box.getByRole("button", { name: "Remove a crew from CCC_Ward_03" }).click();
    await box.getByRole("button", { name: "Add a crew to DSCC_Ward_04" }).click();
    await expect(box.getByText(/This plan can be improved/)).toBeVisible({ timeout: 20_000 });
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
      const recomputed = page.waitForResponse((r) => r.url().includes("/api/intervention/simulate") && r.url().includes("mode=manual") && !r.url().includes("CCC_Ward_03"));
      await box.getByRole("button", { name: "Remove a crew from CCC_Ward_03" }).click();
      await expect(box.getByText("1 of 20 crews left to place.")).toBeVisible();
      await recomputed;
      const add = box.getByRole("button", { name: "Add a crew to CCC_Ward_03" });
      await expect(add).toBeVisible();
      const bb = await add.boundingBox();
      expect(bb!.width).toBeGreaterThanOrEqual(44);                                                 // touch target
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    });
  }
});
