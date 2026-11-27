// Hospital preparedness workspace (mentor scope), against the real local API: every visible number is compared with the API.
import { expect, test } from "./fixtures";

const PAGE = "/response/?origin=2024-08-05&horizon=3&nointro";
const DEMO = "/api/preparedness/plan?origin=2024-08-05&service=p80&city=Dhaka%20North&shock=2&non_dengue=105&dengue_now=100&closed=0&surge=100&saline=60&kits=60&lead=10&los=5&los_other=6&crews=20";

test.describe("Hospital preparedness", () => {
  test("the mentor demonstration drives the real engine and shows the API's numbers", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#prepare");
    await box.getByRole("button", { name: "Mentor demonstration" }).click();
    const api = await (await page.request.get(DEMO)).json();
    const c = api.states.crisis.summary, r = api.states.response.summary;
    const answers = box.getByTestId("prep-answers");
    await expect(box.getByTestId("prep-scenario-id")).toHaveText(api.scenario_id, { timeout: 60_000 });
    await expect(answers).toContainText(`${c.peak_needed} need / ${c.capacity} beds`);
    await expect(answers).toContainText(`${c.saline_required} saline`);
    await expect(answers).toContainText(`${r.referred} referrals`);
    await expect(answers).toContainText(c.status);
    expect(r.referred + r.bed_gap_after_referral).toBe(r.bed_gap_worst_day);
    for (const t of api.states.response.network.transfers) await expect(box.getByRole("cell", { name: t.from_name }).first()).toBeVisible();
    await expect(box.getByText("Live outbreak detection unavailable.")).toBeVisible();
    await expect(box.getByText(/fictional planning hospitals/i).first()).toBeVisible();
  });

  test("a shock changes demand but never the forecast; resetting restores the baseline", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#prepare");
    await box.getByLabel("Planning area").selectOption("Dhaka North");              // immediately, before the URL scenario is restored
    await expect(box.getByRole("button", { name: /Search from the Dhaka North centre/ })).toBeVisible({ timeout: 60_000 });
    const id0 = await box.getByTestId("prep-scenario-id").textContent({ timeout: 60_000 });
    await box.getByRole("group", { name: "Outbreak shock" }).getByRole("button", { name: "+200%" }).click();
    await expect(box.getByTestId("prep-scenario-id")).not.toHaveText(id0!, { timeout: 60_000 });
    const a = await (await page.request.get("/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North")).json();
    const b = await (await page.request.get("/api/preparedness/plan?origin=2024-08-05&city=Dhaka%20North&shock=3")).json();
    expect(b.weekly_cases).toEqual(a.weekly_cases);
    expect(b.states.crisis.summary.peak_needed).toBeGreaterThan(a.states.crisis.summary.peak_needed);
    await box.getByRole("button", { name: "Reset preparedness" }).click();
    await expect(box.getByTestId("prep-scenario-id")).toHaveText(id0!, { timeout: 60_000 });
  });

  test("real hospitals show unknown capacity and only bundled phone numbers", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#prepare");
    await box.getByLabel("Planning area").selectOption("Dhaka North");              // immediately, before the URL scenario is restored
    await expect(box.getByRole("button", { name: /Search from the Dhaka North centre/ })).toBeVisible({ timeout: 60_000 });
    await box.getByRole("button", { name: /Search from the Dhaka North centre/ }).click();
    const tiers = box.getByTestId("real-tiers");
    await expect(tiers).toBeVisible({ timeout: 60_000 });
    await expect(tiers.getByText("Bed availability unconfirmed — contact hospital.").first()).toBeVisible();
    await expect(tiers.getByText(/No bundled road route between regions/).first()).toBeVisible();
    await expect(box.getByRole("link", { name: /999/ })).toHaveAttribute("href", "tel:999");
  });

  test("the brief downloads carry the scenario id shown on screen", async ({ page }) => {
    await page.goto(PAGE);
    const box = page.locator("#prepare");
    await box.getByRole("button", { name: "Mentor demonstration" }).click();
    const id = await box.getByTestId("prep-scenario-id").textContent({ timeout: 60_000 });
    const href = await box.getByRole("link", { name: "Download the preparation brief as CSV" }).getAttribute("href");
    const csv = await (await page.request.get(href!)).text();
    expect(csv).toContain(id!);
  });

  test("a city chosen before the shared scenario finishes restoring is kept, and reaches the URL", async ({ page }) => {
    await page.goto(PAGE);
    const sel = page.locator("#prepare").getByLabel("Planning area");
    await sel.selectOption("Dhaka North");                                       // ~50 ms after load; the restore lands later
    await page.waitForTimeout(1500);
    await expect(sel).toHaveValue("Dhaka North");
    await expect(page).toHaveURL(/city=Dhaka(\+|%20)North/);
    await page.goto(PAGE + "&city=Gazipur");                                     // a deep link still restores normally
    await expect(page.locator("#prepare").getByLabel("Planning area")).toHaveValue("Gazipur", { timeout: 30_000 });
  });

  for (const width of [360, 390]) {
    test(`phones (${width}px): the workspace fits`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(PAGE);
      await page.locator("#prepare").getByRole("button", { name: "Mentor demonstration" }).click();
      await expect(page.locator("#prepare").getByTestId("prep-answers")).toBeVisible({ timeout: 60_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
