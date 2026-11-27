// V4 loading system and chaos tests: real latency, server errors, offline, rapid switching, cancellation and map tile failure.
// Every assertion checks a state the user can actually see; nothing is faked on the page.
import { expect, test } from "./fixtures";

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
      // The status appears after 2.5 s without an answer. Hold the response until it has been seen, then release it, so the check never
      // depends on how fast the page loads (a fixed 3.5 s delay left a 1 s window that a busy CI runner could miss).
      let release!: () => void; const held = new Promise<void>((r) => { release = r; });
      await page.route(FC, async (r) => { await Promise.race([held, sleep(30_000)]); await r.continue().catch(() => {}); });
      await page.goto("/?nointro");
      await expect(page.getByTestId("forecast-preview").getByText(/Forecast: taking longer than usual/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("preview-median")).toHaveCount(0);                          // still waiting: no number is shown early
      release();
      await expect(page.getByTestId("preview-median")).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId("forecast-preview").getByText(/Forecast: taking longer than usual/)).toHaveCount(0);
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

test.describe("V4 accounts on Firebase (configured; no account is signed in)", () => {
  // Needs a Firebase project on both sides: NEXT_PUBLIC_FIREBASE_* at build time and FIREBASE_PROJECT_ID for the API. CI uses the
  // offline demo project "demo-dengueshield-e2e" (placeholder values, no network calls until someone signs in; see .github/workflows/ci.yml).
  test.beforeEach(async ({ page }) => {
    expect((await (await page.request.get("/api/auth/config")).json()).configured, "API started without FIREBASE_PROJECT_ID").toBe(true);
  });
  test("sign-in offers email, password and Google, and explains who needs an account", async ({ page }) => {
    await page.goto("/signin/?nointro");
    await expect(page.getByRole("heading", { name: /Welcome back|Accounts are not set up here yet/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Accounts are not set up here yet"), "dashboard built without NEXT_PUBLIC_FIREBASE_*").toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByText("Every public page works without signing in.")).toBeVisible();
  });

  test("workspaces ask for sign-in and the API refuses requests without a Firebase token", async ({ page }) => {
    for (const path of ["/officer/?nointro", "/admin/?nointro"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible({ timeout: 20_000 });
    }
    for (const api of ["/api/ops/alerts?origin=2024-08-05&horizon=3", "/api/ops/plans", "/api/admin/users", "/api/admin/audit", "/api/auth/me"]) {
      expect((await page.request.get(api)).status()).toBe(401);
    }
    expect((await page.request.get("/api/ops/plans", { headers: { Authorization: "Bearer forged.token.value" } })).status()).toBe(401);
    expect((await (await page.request.get("/api/auth/config")).json()).configured).toBe(true);
  });

  test("the header offers Sign in and the public site keeps working without an account", async ({ page }) => {
    await page.goto("/command/?nointro");
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });
    const nav = page.getByRole("navigation", { name: "Primary" });                                // officer page listed under Respond,
    await nav.getByRole("button", { name: /^Respond/ }).click();                                    // administration only for admins
    await expect(nav.getByRole("link", { name: /Officer workspace/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Administration/ })).toHaveCount(0);
  });
});
