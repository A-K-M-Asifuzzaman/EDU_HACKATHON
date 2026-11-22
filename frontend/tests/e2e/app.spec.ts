import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/profiling/", "/wards/", "/geography/", "/lab/", "/copilot/", "/evidence/", "/response/", "/climate/", "/learn/", "/provenance/"];
const WARD = "DNCC_Ward_19", ORIGIN = "2024-08-05";
const IGNORE = /Failed to load resource|ERR_ABORTED|WebGL|GPU stall|tile|maptiler|WebSocket/i;

// The intro plays once per session; every test except the intro tests starts with it already seen.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => sessionStorage.setItem("ds.intro.seen", "1")); });

function trackErrors(page: Page) {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errs.push(m.text()); });
  return errs;
}
const api = async (page: Page, path: string) => (await page.request.get(path)).json();

test("Command Center shows the same numbers the model API returns", async ({ page }) => {
  const errs = trackErrors(page);
  await page.goto("/");
  const truth = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=3`)).forecast;
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await expect(page.getByText("Validated replay (out-of-time)").first()).toBeVisible();
  const summary = await api(page, `/api/reports/summary?origin=${ORIGIN}&horizon=3`);
  await expect(page.locator("main")).toContainText(String(summary.median_cases_total));            // KPI is model-backed
  await expect(page.locator("canvas").first()).toBeVisible();                                      // fan chart rendered
  await expect(page.locator("main")).toContainText(`${truth.lower_80}–${truth.upper_80}`);
  await expect(page.locator("main")).toContainText("Known limitations");
  expect(errs).toEqual([]);
});

test("every route loads without console or page errors", async ({ page }) => {
  const errs = trackErrors(page);
  for (const r of ROUTES) { await page.goto(r); await expect(page.locator("main h1")).toBeVisible(); await page.waitForTimeout(400); }
  expect(errs).toEqual([]);
});

test("horizon, ward and origin controls change the displayed forecast", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "4 weeks" }).click();
  const h4 = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=4`)).forecast;
  await expect(page.locator("main")).toContainText(`${h4.lower_90}–${h4.upper_90}`);
  await page.getByLabel("Ward", { exact: true }).selectOption("GCC_Ward_02");
  await expect(page.getByText("Forecast with uncertainty — GCC_Ward_02")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast origin" });
  await slider.focus(); await slider.press("ArrowLeft"); await slider.press("ArrowLeft");
  await expect(page.locator("main")).toContainText("22 Jul 2024");
});

test("language switch translates the interface to Bangla and persists", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page.getByRole("heading", { name: "কমান্ড সেন্টার" })).toBeVisible();
  await expect(page.locator("main")).toContainText("ঐতিহাসিক রিপ্লে");
  await page.reload();
  await expect(page.getByRole("heading", { name: "কমান্ড সেন্টার" })).toBeVisible();
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("ward explorer filters, sorts, compares and exports", async ({ page }) => {
  await page.goto("/wards/");
  await expect(page.getByText("Ranked ward risk (60)")).toBeVisible();
  await page.getByPlaceholder("Search wards").fill("GCC");
  await expect(page.getByText("Ranked ward risk (5)")).toBeVisible();
  await page.getByPlaceholder("Search wards").fill("");
  await page.getByRole("radio", { name: "Critical" }).click();
  const crit = (await api(page, `/api/risk/wards?origin=${ORIGIN}&horizon=3&tier=Critical`)).total_matching;
  await expect(page.getByText(`Ranked ward risk (${crit})`)).toBeVisible();
  await page.getByRole("radio", { name: "All" }).click();
  await page.getByLabel("Compare DSCC_Ward_04").check(); await page.getByLabel("Compare CCC_Ward_03").check();
  await expect(page.getByText("Median forecast by horizon")).toBeVisible();
  const dl = page.waitForEvent("download"); await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await dl).suggestedFilename()).toMatch(/dengueshield_wards_.*\.csv/);
  await page.getByRole("button", { name: /DSCC_Ward_04.*Critical/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("profiling studio tabs each render real charts", async ({ page }) => {
  await page.goto("/profiling/");
  await expect(page.getByText("28,200").first()).toBeVisible();                               // observations
  for (const tab of ["Statistics", "Distributions", "Correlations", "Temporal", "Rainfall lags", "Feature engineering", "Modeling diagnostics"]) {
    await page.getByRole("tab", { name: tab }).click(); await expect(page.locator("main canvas, main table").first()).toBeVisible();
  }
  await expect(page.getByText("High weeks under-predicted")).toBeVisible();
});

test("forecast lab explains observed vs projected rainfall per horizon", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.getByText("Which rainfall does this forecast use?")).toBeVisible();
  await expect(page.getByText("projected from past-year climatology").first()).toBeVisible();
  await expect(page.getByText("Rainfall after the origin is never used").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Rainfall timeline around/ })).toBeVisible();
});

test("API outage shows an error state with retry and the shell keeps working", async ({ page }) => {
  await page.route("**/api/metadata", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByRole("alert").first()).toContainText(/Cannot reach|unreachable/i);
  await expect(page.getByRole("link", { name: "Data Profiling Studio" })).toBeVisible();
});

test("Climate Observatory degrades gracefully when NASA POWER and Open-Meteo fail", async ({ page }) => {
  await page.route("**/api/climate/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable", error: "provider unreachable" }) }));
  await page.goto("/climate/");
  await expect(page.getByText(/Optional service unavailable/)).toBeVisible();
  await page.goto("/");                                                                         // forecasts unaffected
  await expect(page.locator("main canvas").first()).toBeVisible();
});

test("Climate Observatory shows both real sources, attribution and separation from the model", async ({ page }) => {
  await page.goto("/climate/");
  await expect(page.getByText("NASA POWER").first()).toBeVisible();
  await expect(page.getByText("Weather data by Open-Meteo.com").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/NASA Langley Research Center/).first()).toBeVisible();
  await expect(page.getByText("Real observations ≠ model inputs")).toBeVisible();
});

test("Copilot renders streamed answers with tools and sources, and handles disabled/error states", async ({ page }) => {
  await page.route("**/api/assistant/status", (r) => r.fulfill({ json: { enabled: true, model: "test-model", retrieval: "BM25 only", limits: { requests_per_hour_per_session: 30, budget_usd: 1 } } }));
  await page.route("**/api/assistant/chat", (r) => {
    const body = [{ type: "sources", sources: [{ id: "S1", source: "docs/model_selection.md", heading: "Champion", excerpt: "ridge Poisson GLM" }] }, { type: "tool", name: "get_model_metrics", args: {} },
      { type: "delta", text: "The **Poisson GLM** was chosen [S1]." }, { type: "done", usage: { est_cost_usd: 0.002 } }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    return r.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.goto("/copilot/");
  await page.getByLabel(/Ask about a ward/).fill("Why a Poisson GLM?"); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("was chosen")).toBeVisible();
  await expect(page.getByText("get_model_metrics")).toBeVisible();
  await page.getByText("Sources (1)").click(); await expect(page.getByText("docs/model_selection.md")).toBeVisible();
  await page.unroute("**/api/assistant/chat");
  await page.route("**/api/assistant/chat", (r) => r.fulfill({ status: 200, json: { enabled: false, message: "Generation is disabled because OPENAI_API_KEY is not configured.", sources: [] } }));
  await page.getByLabel(/Ask about a ward/).fill("again"); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Generation is disabled/)).toBeVisible();
});

test("copilot markdown is sanitised (no script execution)", async ({ page }) => {
  await page.route("**/api/assistant/chat", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "delta", text: "hello <img src=x onerror=\"window.__pwned=1\"> <script>window.__pwned=2</script> [x](javascript:window.__pwned=3)" })}\n\ndata: ${JSON.stringify({ type: "done", usage: {} })}\n\n` }));
  await page.goto("/copilot/");
  await page.getByLabel(/Ask about a ward/).fill("xss test"); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("hello")).toBeVisible(); await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test("3D mosquito loads on demand with WebGL, and the page works without it", async ({ page }) => {
  await page.goto("/learn/");
  await expect(page.getByRole("img", { name: /Conceptual timeline/ })).toBeVisible();
  await page.getByRole("slider", { name: "Weeks since rainfall" }).fill("4");
  await expect(page.getByText("Cases rise.")).toBeVisible();
  const btn = page.getByRole("button", { name: "Load 3D mosquito" });
  if (await btn.isVisible()) { await btn.click(); await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 }); }
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("no horizontal overflow on any route; navigation drawer works; 3D is disabled", async ({ page }) => {
    const errs = trackErrors(page);
    for (const r of ROUTES) {
      await page.goto(r); await expect(page.locator("main h1")).toBeVisible(); await page.waitForTimeout(500);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(o.sw, `${r} overflows`).toBeLessThanOrEqual(o.cw + 1);
    }
    await page.goto("/"); await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Ward Risk Explorer" }).click(); await expect(page).toHaveURL(/wards/);
    await page.goto("/learn/"); await expect(page.getByText(/3D is turned off on this device/)).toBeVisible();
    expect(errs).toEqual([]);
  });
});

test("no API key or secret appears in served pages, scripts or API responses", async ({ page, request }) => {
  const seen: string[] = [];
  page.on("response", async (r) => { const ct = r.headers()["content-type"] ?? ""; if (/html|javascript|json|css/.test(ct)) seen.push(await r.text().catch(() => "")); });
  await page.goto("/"); await page.goto("/copilot/"); await page.goto("/provenance/"); await page.waitForTimeout(800);
  for (const p of ["/api/health", "/api/metadata", "/api/integrations/status", "/api/assistant/status"]) seen.push(await (await request.get(p)).text());
  const all = seen.join("\n");
  expect(all).not.toMatch(/sk-(proj-)?[A-Za-z0-9_-]{20,}/);
  expect(all).not.toMatch(/OPENAI_API_KEY\s*=\s*sk/);
});

// ---- Map & Emergency Routing (real OSM facilities and A* routes served by the API; DGHS boundaries are optional context)
test("map: search a hospital, route to it with A* (verified by Dijkstra), and list the nearest hospitals by road", async ({ page, context }) => {
  const errs = trackErrors(page);
  await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 23.7104, longitude: 90.4074 });
  await page.goto("/geography/");
  await expect(page.getByText("Not live hospital information.")).toBeVisible();
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText(/Your location/)).toBeVisible();
  await page.fill("#geo-search", "Square Hospital");
  await page.getByRole("option").first().click();
  const panel = page.getByRole("complementary", { name: /Facility, route/ });
  await expect(panel.getByText("community-mapped (OpenStreetMap); not verified by DGHS", { exact: false })).toBeVisible();
  await expect(panel.locator('a[href^="tel:"]').first()).toBeVisible();                            // click-to-call from OSM contact data
  await panel.getByRole("button", { name: /Route from start/ }).click();
  await expect(panel.getByText("Dijkstra check")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("✓ equal")).toHaveCount(2);
  await page.getByRole("button", { name: "Nearest hospitals by road" }).click();
  await expect(panel.getByText(/Closest hospitals by estimated road travel time/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Routing engine diagnostics/)).toBeVisible();
  await expect(page.getByText(/A\* matched Dijkstra's optimal cost in/)).toBeVisible();
  expect(errs).toEqual([]);
});

test("map: forecasts stay at city level, the abstract ward matrix is separate, and an unreachable DGHS layer degrades gracefully", async ({ page }) => {
  await page.route("**/api/geo/dghs/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable", error: "ConnectTimeout: simulated", id_mapping: { verified: false } }) }));
  await page.goto("/geography/");
  await expect(page.getByRole("img", { name: /forecast: \d+ of \d+ synthetic wards alerting/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^DNCC_Ward_\d+ / }).first()).toBeVisible();      // abstract matrix of synthetic wards
  await page.getByRole("switch", { name: "DGHS boundaries" }).click();
  await expect(page.getByText(/DGHS boundaries unavailable/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Facility directory \(\d+\)/)).toBeVisible();                       // the rest of the page keeps working
});

test("emergency help is one click away on every page and opens instantly with published numbers", async ({ page }) => {
  await page.route("**/api/**", (r) => r.abort());                                                // works even when the API is down
  await page.goto("/evidence/");
  await page.getByRole("button", { name: /Emergency help/ }).click();
  const dlg = page.getByRole("dialog", { name: "Emergency help" });
  await expect(dlg.locator('a[href="tel:999"]')).toBeVisible();
  await expect(dlg.locator('a[href="tel:16263"]')).toBeVisible();
  await expect(dlg.getByText("severe abdominal pain")).toBeVisible();
});

test.describe("intro", () => {
  test.use({ reducedMotion: "no-preference" });                                                  // the config default is "reduce", which (correctly) skips the intro
  test("plays once: swat to reveal the dashboard, never replays on navigation", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.removeItem("ds.intro.seen"));                   // runs after the global seen-flag script
    await page.goto("/");
    const intro = page.getByRole("dialog", { name: /introduction/ });
    await expect(intro).toBeVisible();
    await expect(page.locator("main h1")).toBeAttached();                                         // the app loads underneath, not blocked
    await page.mouse.click(700, 420);
    await expect(intro).toBeHidden({ timeout: 5_000 });
    await page.getByRole("link", { name: /Model Evidence/ }).first().click();
    await expect(page.locator("main h1")).toBeVisible();
    await expect(intro).toHaveCount(0);
  });
  test("skip and keyboard work; emergency help is reachable from the intro", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.removeItem("ds.intro.seen"));
    await page.goto("/");
    await page.getByRole("dialog", { name: /introduction/ }).getByRole("button", { name: /Emergency help/ }).click();
    await expect(page.getByRole("dialog", { name: "Emergency help" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() => sessionStorage.removeItem("ds.intro.seen")); await page.reload();
    await expect(page.getByRole("dialog", { name: /introduction/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /introduction/ })).toBeHidden();
  });
  test("sound is off by default and only starts on request", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.removeItem("ds.intro.seen"));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Turn sound on" })).toHaveAttribute("aria-pressed", "false");
  });
  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("is skipped entirely under prefers-reduced-motion", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.removeItem("ds.intro.seen"));
      await page.goto("/");
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByRole("dialog", { name: /introduction/ })).toHaveCount(0);
    });
  });
});

// ---- decision intelligence and release-polish features
test("reliability center shows saved out-of-time diagnostics and the alert policy simulator reproduces the deployed rule", async ({ page }) => {
  const errs = trackErrors(page);
  await page.goto("/evidence/");
  await expect(page.getByRole("tab", { name: "Reliability center" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Coverage by incidence severity")).toBeVisible();
  await expect(page.getByText("0.607")).toBeVisible();                                           // documented peak coverage, 80% nominal
  await expect(page.getByText("0.740")).toBeVisible();
  await expect(page.getByText("Outbreak alert policy simulator")).toBeVisible();
  const deployed = page.getByRole("row", { name: /Deployed rule \(as validated\)/ });
  await expect(deployed).toContainText("75.8%");                                                 // recall at 3 weeks, same as diagnostics
  const before = await page.getByText("Flagged ward-weeks").locator("..").innerText();
  await page.getByRole("slider", { name: "Alert threshold" }).fill("0.6");
  await expect(page.getByText("Flagged ward-weeks").locator("..")).not.toHaveText(before);
  await expect(page.getByText(/optimistic/).first()).toBeVisible();
  expect(errs).toEqual([]);
});

test("resource sandbox compares three transparent rules and labels itself a planning simulation", async ({ page }) => {
  await page.goto("/response/");
  await expect(page.getByText("Planning simulation, not a deployment recommendation.")).toBeVisible();
  for (const n of ["Equal (risk-blind)", "Historical risk", "Forecast alert priority"]) await expect(page.getByText(n).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/share of actual outbreak ward-weeks/)).toBeVisible({ timeout: 20_000 });
});

test("command center: time-machine verdict, play control, intelligence brief and global search", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Time-machine verdict")).toBeVisible();
  await expect(page.getByText(/Out-of-time: forecast by a model trained only on seasons before/)).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Weekly situation report/ }).click();
  const rep = await popup; await rep.waitForLoadState("domcontentloaded");
  const html = await rep.content();
  expect(html).toContain("HISTORICAL REPLAY"); expect(html).toContain("SYNTHETIC COMPETITION DATA");          // must never read like a live official warning
  expect(html).toContain("not an official publication"); expect(html).toContain("not official guidance");
  expect(html).not.toMatch(/Directorate General of Health Services|AUDITED|Chief Health Officer/);              // no impersonation of a real authority
  await rep.close();
  await page.getByRole("button", { name: /Play time machine/ }).click();
  await expect(page.getByRole("button", { name: /Pause time machine/ })).toBeVisible();
  await page.getByRole("button", { name: /Pause time machine/ }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: /Search pages, wards/ }).fill("square hospital");
  await expect(page.getByRole("option").filter({ hasText: "Square Hospital" }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/geography\/\?facility=osm/);
  await expect(page.getByRole("complementary", { name: /Facility, route/ }).getByText("Square Hospital").first()).toBeVisible({ timeout: 20_000 });
});

test("map: A* insight mode reports real exploration counts for A* and Dijkstra", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 23.7104, longitude: 90.4074 });
  await page.goto("/geography/");
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.fill("#geo-search", "Square Hospital"); await page.getByRole("option").first().click();
  const panel = page.getByRole("complementary", { name: /Facility, route/ });
  await panel.getByRole("button", { name: /Route from start/ }).click();
  await panel.getByRole("switch", { name: /A\* Algorithm Insight/ }).click();
  await expect(panel.getByText(/costs equal ✓/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/fewer nodes toward the goal/)).toBeVisible();
  await expect(panel.getByRole("link", { name: /Open in Google Maps/ })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&origin=23\.7104,90\.4074&destination=/);
});

test("provenance document viewer opens architecture details and related documents", async ({ page }) => {
  await page.goto("/provenance/");
  await page.getByRole("button", { name: /DengueShield AI: Architecture/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("link", { name: "ML pipeline", exact: true }).click();
  await expect(dlg.getByRole("heading", { name: "ML pipeline: from raw data to a calibrated forecast bundle" })).toBeVisible();
  await dlg.getByRole("link", { name: "Architecture overview" }).click();
  await expect(dlg).toHaveAttribute("aria-label", "ARCHITECTURE.md");
  await dlg.getByRole("link", { name: "ML pipeline", exact: true }).click();
  await dlg.getByRole("link", { name: "model_selection.md", exact: true }).click();
  await expect(dlg.getByRole("heading", { name: "Model selection (Stage 3)" })).toBeVisible();
  await expect(page).toHaveURL(/\/provenance\/?$/);
});
