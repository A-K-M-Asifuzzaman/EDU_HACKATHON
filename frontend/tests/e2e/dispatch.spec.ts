// Stage 4: dispatch desk. Copies and downloads must come from the displayed snapshot; nothing is sent anywhere.
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

const PAGE = "/response/?ward=DSCC_Ward_04&origin=2024-08-05&horizon=3&nointro";

async function ready(page: any) {
  await page.goto(PAGE);
  const box = page.locator("#dispatch");
  await expect(box.getByTestId("sms-text")).toContainText("DSCC_Ward_04", { timeout: 40_000 });
  return box;
}

test.describe("Dispatch briefs", () => {
  test("SMS preview, key numbers and clipboard copy come from one snapshot", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const box = await ready(page);
    const sid = (await box.getByTestId("scenario-id").innerText()).trim();
    expect(sid).toMatch(/^S-[0-9a-f]{12}$/);
    await expect(box.getByTestId("sms-text")).toContainText(`Ref ${sid}`);
    await expect(box.getByTestId("sms-stats")).toHaveText(/\d+ characters, GSM-7, \d SMS segments?/);
    await expect(box.getByTestId("key-numbers")).toContainText("Saline bags45 of 45");
    await box.getByRole("button", { name: "Copy SMS" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await box.getByTestId("sms-text").innerText());
    await box.getByRole("tab", { name: "WhatsApp" }).click();
    await expect(box.getByTestId("whatsapp-text")).toContainText("Not an outbreak report");
  });

  test("PDF and HTML downloads carry the displayed scenario", async ({ page }) => {
    const box = await ready(page);
    const sid = (await box.getByTestId("scenario-id").innerText()).trim();
    for (const [name, magic] of [["Download this ward as PDF", "%PDF-1.4"], ["Download this ward as HTML", "<!doctype html>"],
                                 ["Download city summary as PDF", "%PDF-1.4"], ["Download wards needing attention as HTML", "<!doctype html>"]] as const) {
      const dl = page.waitForEvent("download");
      await box.getByRole("button", { name }).click();
      const file = await dl;
      expect(file.suggestedFilename()).toContain(sid);
      const body = readFileSync((await file.path())!, "latin1");
      expect(body.startsWith(magic)).toBe(true);
      expect(body).toContain(sid);
    }
  });

  test("changing the scenario above produces a new snapshot", async ({ page }) => {
    const box = await ready(page);
    const before = (await box.getByTestId("scenario-id").innerText()).trim();
    await page.locator("#supply").getByLabel("Regional stock").fill("40");
    await expect(box.getByTestId("scenario-id")).not.toHaveText(before, { timeout: 30_000 });
    const after = (await box.getByTestId("scenario-id").innerText()).trim();
    await expect(box.getByTestId("sms-text")).toContainText(`Ref ${after}`);
    await expect(box.getByTestId("snapshot")).toContainText("Stock 40%");
  });

  test("rapid control changes settle on the last settings in every section", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const box = await ready(page);
    const stock = page.locator("#supply").getByLabel("Regional stock");
    for (const v of ["30", "90", "45", "70", "55"]) await stock.fill(v);                          // faster than the debounce
    await page.locator("#surge").getByRole("radio", { name: "+50%" }).click();
    await page.locator("#surge").getByRole("radio", { name: "+20% surge beds" }).click();
    const q = "origin=2024-08-05&horizon=3";
    const a = await page.evaluate(async (p) => (await fetch(p)).json(), `/api/allocation/plan?${q}&stock=0.55`);
    const t = a.totals.saline_bags_needed;
    await expect(page.locator("#supply").getByText(`of ${t.demand} needed; supply ${t.supply}; short ${t.unmet}`)).toBeVisible({ timeout: 30_000 });
    const o = await page.evaluate(async (p) => (await fetch(p)).json(), `/api/overflow/plan?${q}&capacity_pct=120&stock=0.55`);
    await expect(page.locator("#surge").getByRole("alert")).toContainText(`${o.totals.unresolved} projected patients`);
    await expect(box.getByTestId("snapshot")).toContainText("Stock 55%", { timeout: 30_000 });
    await expect(box.getByTestId("snapshot")).toContainText("capacity 120%");
    const sid = (await box.getByTestId("scenario-id").innerText()).trim();
    await expect(box.getByTestId("sms-text")).toContainText(`Ref ${sid}`);
    expect(errors).toEqual([]);
  });

  test("Bangla notices are UCS-2 and render in Bengali", async ({ page }) => {
    const box = await ready(page);
    await box.getByRole("radio", { name: "বাংলা" }).click();
    await expect(box.getByTestId("sms-text")).toContainText("ডেঙ্গুশিল্ড");
    await expect(box.getByTestId("sms-stats")).toContainText("UCS-2");
  });

  for (const theme of ["light", "dim"]) {
    test(`dispatch tabs have no serious or critical axe violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("ds.theme", t), theme);
      const box = await ready(page);
      await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });   // test-only, as in app.spec
      for (const tab of ["SMS", "WhatsApp", "Printable brief", "Assumptions and sources"]) {
        await box.getByRole("tab", { name: tab }).click();
        await page.waitForTimeout(300);
        const res: any = await page.evaluate(async () => (window as any).axe.run("#dispatch", { runOnly: ["wcag2a", "wcag2aa"] }));
        const bad = res.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious").map((v: any) => `${tab}: ${v.id} ${v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")).join(" | ")}`);
        expect(bad).toEqual([]);
      }
    });
  }

  for (const w of [360, 390]) {
    test(`at ${w}px the export controls are usable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 860 });
      const box = await ready(page);
      const btn = box.getByRole("button", { name: "Download this ward as PDF" });
      const bb = await btn.boundingBox();
      expect(bb!.height).toBeGreaterThanOrEqual(40);
      const dl = page.waitForEvent("download");
      await btn.click();
      expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    });
  }
});
