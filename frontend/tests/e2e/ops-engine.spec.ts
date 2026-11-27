// Operations engine (Response page): the shell, the causal rail, the allocation instrument, the ward transfer network and the hospital
// map, checked against the real local API (origin 2024-08-05, h=3). Every visual count is compared with the API's own numbers.
import { expect, test } from "./fixtures";

const PAGE = "/response/?origin=2024-08-05&horizon=3&nointro";
const PLAN = (cap: number) => `/api/overflow/plan?origin=2024-08-05&horizon=3&service=p80&capacity_pct=${cap}&stock=0.6`;
const beds = (page: any) => page.getByRole("group", { name: "Ward beds" });
const rail = (page: any, name: RegExp) => page.getByRole("navigation", { name: "Engine stages" }).getByRole("link", { name });
const arcs = (page: any) => page.locator("#surge svg path.ops-draw");

test.describe("Operations engine", () => {
  test("the rail shows each stage's computed result and follows a scenario change", async ({ page }) => {
    await page.goto(PAGE);
    await expect(rail(page, /Forecast/)).toContainText("743 cases", { timeout: 30_000 });
    await expect(rail(page, /Demand/)).toContainText("224 beds");
    await expect(rail(page, /Allocation/)).toContainText("60% supplied");
    await expect(rail(page, /Surge/)).toContainText("53 without a bed");
    await expect(rail(page, /Intervention/)).toContainText("63.2 fewer cases", { timeout: 30_000 });
    await expect(rail(page, /Dispatch/)).toContainText("S-", { timeout: 30_000 });
    await beds(page).getByRole("button", { name: "+20%" }).click();
    await expect(rail(page, /Surge/)).toContainText("16 without a bed", { timeout: 30_000 });
    await expect(rail(page, /Demand/)).toContainText("224 beds");                  // beds change the overflow, never the forecast
    await expect(page.locator("#surge").getByLabel("Ward capacity, % of baseline")).toHaveValue("120");   // one shared plan state
    await page.getByRole("group", { name: "Regional stock" }).getByRole("button", { name: "100%" }).click();
    await expect(rail(page, /Allocation/)).toContainText("100% supplied", { timeout: 30_000 });
    await expect(rail(page, /Surge/)).toContainText("16 without a bed");           // stock never adds hospital beds
  });

  test("the network draws exactly the API's transfers: none at 100%, the real links at +20% and +30%", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#surge");
    await expect(box.getByRole("alert")).toContainText("53 projected patients", { timeout: 30_000 });
    await expect(arcs(page)).toHaveCount(0);
    await expect(box.getByText("No ward in Dhaka North has a spare bed, so no patient can move.")).toBeVisible();
    for (const cap of [120, 130]) {
      const api = await (await page.request.get(PLAN(cap))).json();
      await beds(page).getByRole("button", { name: `+${cap - 100}%` }).click();
      if (api.totals.unresolved) await expect(box.getByRole("alert")).toContainText(`${api.totals.unresolved} projected patient`, { timeout: 30_000 });
      else await expect(box.getByRole("status").filter({ hasText: "Every projected patient has a bed" })).toBeVisible({ timeout: 30_000 });
      expect(api.transfers.length).toBeGreaterThan(0);
      await expect(arcs(page)).toHaveCount(api.transfers.length);
      // arc labels carry the API's patient counts; their sum is the API total (nothing duplicated, nothing invented)
      const labels = await box.locator("svg g:has(path.ops-draw) text").allTextContents();
      expect(labels.map(Number).reduce((a: number, b: number) => a + b, 0)).toBe(api.totals.transferred);
      // invariants of the plan itself: same-city links, no receiver over its spare beds, patients conserved
      const ward = new Map(api.wards.map((w: any) => [w.ward_id, w]));
      for (const t of api.transfers) expect([(ward.get(t.from_ward) as any).city, (ward.get(t.to_ward) as any).city]).toEqual([t.city, t.city]);
      for (const w of api.wards) { expect(w.received).toBeLessThanOrEqual(w.headroom); expect(w.sent + w.unresolved).toBe(w.deficit); }
      expect(api.wards.reduce((a: number, w: any) => a + w.sent, 0)).toBe(api.totals.transferred);
      expect(api.wards.reduce((a: number, w: any) => a + w.received, 0)).toBe(api.totals.transferred);
      // each cluster lists only its own city's links
      for (const c of api.cities) await expect(box.getByRole("group", { name: new RegExp(`^${c.city} ward network, ${api.transfers.filter((t: any) => t.city === c.city).length} transfer link`) })).toHaveCount(1);
    }
    await expect(page.getByTestId("surge-delta")).toBeVisible();                     // comparison with the previous setting
  });

  test("rapid scenario changes settle on the last one (no stale answer wins)", async ({ page }) => {
    await page.route(/\/api\/overflow\/plan.*capacity_pct=120/, async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    await page.goto(PAGE);
    await expect(rail(page, /Surge/)).toContainText("53 without a bed", { timeout: 30_000 });
    await beds(page).getByRole("button", { name: "+20%" }).click();
    await beds(page).getByRole("button", { name: "+50%" }).click();
    await beds(page).getByRole("button", { name: "Baseline" }).click();
    await page.waitForTimeout(2500);
    await expect(rail(page, /Surge/)).toContainText("53 without a bed");
    await expect(arcs(page)).toHaveCount(0);
  });

  test("ward glyphs and allocation columns are keyboard reachable and drive the inspectors", async ({ page }) => {
    await page.goto(PAGE);
    const sn = page.locator("#surge");
    await expect(sn.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    const first = sn.locator('g[role="button"][tabindex="0"]');
    await first.focus();
    const before = await sn.getByRole("complementary", { name: "Network inspector" }).innerText();
    await page.keyboard.press("ArrowRight");
    await expect(sn.getByRole("complementary", { name: "Network inspector" })).not.toHaveText(before);
    const af = page.locator("#supply");
    await expect(af.getByText(/of 1767 needed/)).toBeVisible({ timeout: 30_000 });
    await af.getByRole("button", { name: /^DSCC_Ward_04, priority 1:/ }).click();
    await expect(af.getByRole("complementary", { name: "Selected ward" })).toContainText("DSCC_Ward_04");
    await page.keyboard.press("End");
    await expect(af.getByRole("complementary", { name: "Selected ward" })).not.toContainText("DSCC_Ward_04");
  });

  test("the hospital map shows real OSM hospitals and five city gauges, never a ward position", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#surge");
    await expect(box.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    await box.getByRole("button", { name: "Hospital map" }).click();
    await expect(box.getByText(/631 OpenStreetMap hospitals/)).toBeVisible({ timeout: 30_000 });
    const gauges = box.getByRole("button", { name: /synthetic-ward aggregate/ });
    await expect(gauges).toHaveCount(5, { timeout: 30_000 });
    await expect(box.locator(".maplibregl-marker")).toHaveCount(5);
    await expect(box.locator(".maplibregl-marker", { hasText: /_Ward_/ })).toHaveCount(0);
    // the map opens framed on the five city centres, so every gauge is inside the visible map
    await page.waitForTimeout(500);
    const frame = (await box.locator("canvas.maplibregl-canvas").boundingBox())!;
    for (const g of await gauges.all()) {
      const r = (await g.boundingBox())!, cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      expect(cx > frame.x && cx < frame.x + frame.width && cy > frame.y && cy < frame.y + frame.height).toBe(true);
    }
    await gauges.filter({ hasText: "Chattogram" }).click();
    await expect(box.getByRole("complementary", { name: "Map inspector" })).toContainText("Projected bed need");
    await box.getByRole("button", { name: "Ward transfer network" }).click();     // the chosen city carries over to the network view
    await expect(box.getByRole("complementary", { name: "Network inspector" })).toContainText("Chattogram");
  });

  test("the engine stays idle when nothing changes (no render loop in the rail or the visuals)", async ({ page }) => {
    await page.goto(PAGE);
    await expect(rail(page, /Dispatch/)).toContainText("S-", { timeout: 30_000 });
    await expect(rail(page, /Intervention/)).toContainText("fewer cases", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const n = await page.evaluate(() => new Promise<number>((res) => {
      let k = 0; new MutationObserver((ms) => { k += ms.length; }).observe(document.getElementById("engine")!, { subtree: true, attributes: true, childList: true, characterData: true });
      setTimeout(() => res(k), 3000);
    }));
    expect(n).toBe(0);
  });

  for (const width of [360, 390]) {
    test(`phones (${width}px): no sideways scroll, stage bar and scenario sheet work`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PAGE);
      await page.locator("#engine").scrollIntoViewIfNeeded();
      await expect(rail(page, /Surge/)).toContainText("53 without a bed", { timeout: 30_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.locator("#surge").scrollIntoViewIfNeeded();
      const bar = page.getByRole("link", { name: /02\s*Surge/ });
      await expect(bar).toBeVisible();
      await page.getByRole("button", { name: "Scenario" }).last().click();
      const sheet = page.getByRole("dialog", { name: "Scenario" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("group", { name: "Ward beds" }).getByRole("button", { name: "+20%" }).click();
      await sheet.getByRole("button", { name: "Done" }).click();
      await expect(rail(page, /Surge/)).toContainText("16 without a bed", { timeout: 30_000 });
    });
  }
});
