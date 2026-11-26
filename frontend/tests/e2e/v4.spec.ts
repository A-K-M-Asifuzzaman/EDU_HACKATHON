// V4 loading system and chaos tests: real latency, server errors, offline, rapid switching, cancellation and map tile failure.
// Every assertion checks a state the user can actually see; nothing is faked on the page.
import { expect, test } from "@playwright/test";

const FC = /\/api\/forecast\?/;                       // the single-forecast endpoint (not /series)
const CMD = "/command/?ward=DNCC_Ward_19&origin=2024-08-05&horizon=3&nointro";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe("V4 latency", () => {
  for (const ms of [500, 2000, 5000, 15000]) {
    test(`forecast delayed ${ms} ms: skeleton and honest status, then the real forecast`, async ({ page }) => {
      test.setTimeout(ms + 60_000);
      await page.route(FC, async (r) => { await sleep(ms); await r.continue().catch(() => {}); });
      await page.goto(CMD);
      if (ms > 2500) await expect(page.getByText("Forecast: taking longer than usual. Still waiting for the service…")).toBeVisible();
      await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: ms + 25_000 });
      await expect(page.getByText(/Forecast: taking longer than usual/)).toHaveCount(0);
    });
  }

  for (const w of [360, 390, 430, 768, 1440]) {
    test(`landing at ${w}px: a slow forecast shows its status inside the preview and the page never scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 860 });
      await page.route(FC, async (r) => { await sleep(3500); await r.continue().catch(() => {}); });
      await page.goto("/?nointro");
      await expect(page.getByTestId("forecast-preview").getByText(/Forecast: taking longer than usual/)).toBeVisible();
      await expect(page.getByTestId("preview-median")).toBeVisible({ timeout: 25_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    });
  }
});

test.describe("V4 failures and recovery", () => {
  test("forecast 500: retries with backoff, then a labelled failure panel, then recovery on Try again", async ({ page }) => {
    let fail = true, calls = 0;
    await page.route(FC, (r) => { calls++; return fail ? r.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"injected"}' }) : r.continue(); });
    await page.goto(CMD);
    await expect(page.getByText(/Forecast: The service reported an error \(500\)\. Retrying \(attempt 2 of 3\)/)).toBeVisible();
    const panel = page.getByRole("alert").filter({ hasText: "The forecast is unavailable right now" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    expect(calls).toBeGreaterThanOrEqual(3);                                               // first try + two backoff retries
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();          // the shell keeps working
    fail = false;
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 20_000 });
  });

  test("ward risk 503: the Wards page names what failed and links to saved evidence", async ({ page }) => {
    await page.route(/\/api\/risk\/wards/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto("/wards/?nointro");
    const panel = page.getByRole("alert").filter({ hasText: "Ward risk matrix is unavailable right now" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText("The service reported an error (503).")).toBeVisible();
    await expect(panel.getByRole("link", { name: /Model evidence/ })).toBeVisible();
  });

  test("landing preview at 360px: a failing forecast says so and offers Try again", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route(FC, (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto("/?nointro");
    const prev = page.getByTestId("forecast-preview");
    await expect(prev.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(prev.getByRole("button", { name: /Try again/ })).toBeVisible();
  });

  test("offline: a selection change fails honestly, then recovers when the network returns", async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto(CMD);
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 20_000 });
    await context.setOffline(true);
    await page.getByRole("radio", { name: "4 weeks", exact: true }).first().click();
    const panel = page.getByRole("alert").filter({ hasText: "The forecast is unavailable right now" });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/could not be reached/)).toBeVisible();
    await context.setOffline(false);
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("answer-card")).toContainText("Forecast · 4 weeks ahead", { timeout: 20_000 });
  });
});

test.describe("V4 race conditions and cancellation", () => {
  test("rapid horizon switching: slow older answers never replace the newest selection", async ({ page }) => {
    await page.goto(CMD);
    const card = page.getByTestId("answer-card");
    await expect(card).toContainText("26 Aug 2024", { timeout: 20_000 });                    // horizon 3 from 5 Aug → week of 26 Aug
    await page.route(FC, async (r) => {
      const h = new URL(r.request().url()).searchParams.get("horizon");
      await sleep(h === "2" ? 3000 : h === "4" ? 1500 : 0); await r.continue().catch(() => {});
    });
    const radio = (n: number) => page.getByRole("radio", { name: `${n} weeks`, exact: true }).first();
    await radio(2).click(); await radio(4).click(); await radio(3).click();
    await expect(page).toHaveURL(/horizon=3/);
    await sleep(4000);                                                                        // let the slow horizon-2 and -4 answers arrive
    await expect(card).toContainText("Forecast · 3 weeks ahead");
    await expect(card).toContainText("26 Aug 2024");
    await expect(card).not.toContainText("19 Aug 2024");                                     // horizon 2's target week
    await expect(card).not.toContainText("2 Sept 2024");
  });

  test("route search shows elapsed progress, can be cancelled, and the cancelled answer never appears later", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 23.7104, longitude: 90.4074 });
    await page.route(/\/api\/route\?/, async (r) => { await sleep(4000); await r.continue().catch(() => {}); });
    await page.goto("/geography/?nointro");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText(/Your location/)).toBeVisible();
    await page.fill("#geo-search", "Square Hospital");
    await page.getByRole("option").first().click();
    const panel = page.getByRole("complementary", { name: /Facility, route/ });
    await panel.getByRole("button", { name: /Route from start/ }).click();
    const prog = panel.getByTestId("action-progress");
    await expect(prog).toContainText("Finding the fastest and shortest road routes");
    await expect(prog).toContainText("Route search runs on the server's road graph", { timeout: 6_000 });   // honest slow notice after 2.5 s
    await prog.getByRole("button", { name: "Cancel" }).click();
    await expect(prog).toHaveCount(0);
    await sleep(4500);                                                                        // the cancelled answer must not appear later
    await expect(panel.getByText("Dijkstra check")).toHaveCount(0);
  });
});

test.describe("V4 map resilience", () => {
  test("failed basemap tiles are reported while facilities still load", async ({ page }) => {
    await page.route(/api\.maptiler\.com\/tiles\//, (r) => r.abort());
    await page.goto("/geography/?nointro");
    const noWebGL = page.getByText(/The map could not start/);
    await page.waitForTimeout(4000);
    test.skip(await noWebGL.isVisible(), "WebGL unavailable in this browser: the no-map fallback is covered elsewhere");
    await expect(page.getByText("Some basemap tiles did not load. Facilities, routes and risk overlays still work.")).toBeVisible({ timeout: 20_000 });
    await page.fill("#geo-search", "Square Hospital");
    await expect(page.getByRole("option").first()).toBeVisible();                             // facility search still works
  });
});
