import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/command/", "/profiling/", "/wards/", "/geography/", "/lab/", "/copilot/", "/evidence/", "/response/", "/climate/", "/learn/", "/provenance/"];
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
  await page.goto("/command/");
  const truth = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=3`)).forecast;
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await expect(page.getByText("Validated replay (out-of-time)").first()).toBeVisible();
  const summary = await api(page, `/api/reports/summary?origin=${ORIGIN}&horizon=3`);
  await expect(page.locator("main")).toContainText(String(summary.median_cases_total));            // KPI is model-backed
  await expect(page.locator("canvas").first()).toBeVisible();                                      // fan chart rendered
  await expect(page.locator("main")).toContainText(`${truth.lower_80}-${truth.upper_80}`);                       // ranges use a hyphen (DESIGN.md copy rules)
  await expect(page.locator("main")).toContainText("Known limitations");
  expect(errs).toEqual([]);
});

test("every route loads without console or page errors", async ({ page }) => {
  const errs = trackErrors(page);
  for (const r of ROUTES) { await page.goto(r); await expect(page.locator("main h1")).toBeVisible(); await page.waitForTimeout(400); }
  expect(errs).toEqual([]);
});

test("horizon, ward and origin controls change the displayed forecast", async ({ page }) => {
  await page.goto("/command/");
  await page.getByRole("radio", { name: "4 weeks" }).click();
  const h4 = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=4`)).forecast;
  await expect(page.locator("main")).toContainText(`${h4.lower_90}-${h4.upper_90}`);
  await page.getByLabel("Ward", { exact: true }).selectOption("GCC_Ward_02");
  await expect(page.getByTestId("answer-card").getByRole("heading", { name: /GCC_Ward_02/ })).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast origin" });
  await slider.focus(); await slider.press("ArrowLeft"); await slider.press("ArrowLeft");
  await expect(page.locator("main")).toContainText("22 Jul 2024");
});

test("language switch translates the interface to Bangla and persists", async ({ page }) => {
  await page.goto("/command/");
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
  await page.goto("/command/");
  await expect(page.getByRole("alert").first()).toContainText(/Cannot reach|unreachable/i);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Forecast/ }).click();     // V4 shell: grouped menus still open
  await expect(page.getByRole("link", { name: /Data Profiling Studio/ })).toBeVisible();
});

test("Climate Observatory degrades gracefully when NASA POWER and Open-Meteo fail", async ({ page }) => {
  await page.route("**/api/climate/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable", error: "provider unreachable" }) }));
  await page.goto("/climate/");
  await expect(page.getByText(/Optional service unavailable/)).toBeVisible();
  await page.goto("/command/");                                                                         // forecasts unaffected
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
  expect(all).not.toMatch(/(?<![A-Za-z0-9])sk-(proj-)?[A-Za-z0-9_-]{20,}/);   // a standalone token: "space-grotesk-latin-…" font names are not keys
  expect(all).not.toMatch(/OPENAI_API_KEY\s*=\s*sk/);
});

// ---- Map & Emergency Routing (real OSM facilities and A* routes served by the API; DGHS boundaries are optional context)
test("map: search a hospital, route to it with A* (verified by Dijkstra), and list the nearest hospitals by road", async ({ page, context }) => {
  const errs = trackErrors(page);
  await context.grantPermissions(["geolocation"]); await context.setGeolocation({ latitude: 23.7104, longitude: 90.4074 });
  await page.goto("/geography/");
  await expect(page.getByText("Not live hospital information.", { exact: true })).toBeVisible();
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
  await expect(panel.getByText(/General hospitals by estimated road travel time/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/Veterinary, diagnostic-only and specialist facilities/)).toBeVisible();      // eligibility is explained
  await expect(panel.getByText(/Emergency: (unknown|tagged in OSM, unverified)/).first()).toBeVisible();
  await expect(panel.getByText(/confirmed|guaranteed/i)).toHaveCount(0);                         // never claims verified emergency care
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
  await expect(page.getByText("0.607").first()).toBeVisible();                                           // documented peak coverage, 80% nominal
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
  await page.goto("/command/");
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

test("provenance document viewer opens the architecture overview, the complete reference and related documents", async ({ page }) => {
  await page.goto("/provenance/");
  await page.getByRole("button", { name: /DengueShield AI: Architecture/ }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toHaveAttribute("aria-label", "ARCHITECTURE.md");
  await dlg.getByRole("link", { name: "docs/architecture/COMPLETE_ARCHITECTURE.md" }).first().click();
  await expect(dlg.getByRole("heading", { name: "DengueShield AI: complete architecture reference" })).toBeVisible();
  await dlg.getByRole("link", { name: "model_selection.md", exact: true }).first().click();
  await expect(dlg.getByRole("heading", { name: "Model selection (Stage 3)" })).toBeVisible();
  await expect(page).toHaveURL(/\/provenance\/?/);
});

test("climate futures: exploratory scenarios are separate, computed live, comparable and bounded", async ({ page }) => {
  await page.goto("/lab/");
  const sec = page.getByRole("region", { name: "Climate Futures 2026–2030" });
  await sec.scrollIntoViewIfNeeded();
  await expect(sec.getByText("Exploratory multi-year climate scenario")).toBeVisible();
  await expect(sec.getByText(/Median cases · 2026/)).toBeVisible({ timeout: 20_000 });
  await expect(sec.getByText("M0 climatology")).toBeVisible({ timeout: 20_000 });          // backtest vs baseline
  await expect(sec.getByText(/not a demonstrated causal effect/)).toBeVisible();
  await sec.getByRole("radio", { name: "Custom" }).click();
  await sec.getByLabel("Rainfall multiplier").fill("1.3");
  await expect(sec.getByText("1.30×")).toBeVisible();
  await sec.getByLabel("Scenario year").selectOption("2030");
  await expect(sec.getByText(/Median cases · 2030/)).toBeVisible({ timeout: 20_000 });
});

test.describe("V3", () => {
  for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
    test(`answer card shows the forecast in the first screen, nothing covers it, no sideways scroll at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto("/command/?nointro");
      await expect(page.getByRole("heading", { name: /DNCC_Ward_19/ }).first()).toBeVisible({ timeout: 20_000 });
      const card = page.getByTestId("answer-card");
      const median = card.getByText("Median forecast");
      const mb = (await median.boundingBox())!;
      expect(mb.y + mb.height).toBeLessThan(vp.height);                                             // the forecast number itself is above the fold
      await expect(card.getByText(/synthetic ward/)).toBeVisible();
      await expect(card.getByText(/How reliable at 3 weeks/)).toBeVisible();
      await expect(card.getByRole("navigation", { name: "Next steps" }).getByRole("link", { name: /Plan a response/ })).toBeVisible();
      // the Copilot launcher lives in the top bar; no fixed element may sit on top of the answer card
      await expect(page.getByRole("button", { name: "DengueShield Copilot" })).toBeVisible();
      const overlaps = await page.evaluate(() => {
        const c = document.querySelector("[data-testid=answer-card]")!.getBoundingClientRect();
        return [...document.querySelectorAll("body *")].filter((e) => getComputedStyle(e).position === "fixed").map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0 && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top).length;
      });
      expect(overlaps).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    });
  }

  test("Back and Forward restore each page's selection (URL state)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });                                     // sidebar navigation visible
    await page.goto("/command/?ward=DNCC_Ward_19&origin=2024-08-05&horizon=3&nointro");
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("radio", { name: "2 weeks", exact: true }).first().click();
    await expect(page).toHaveURL(/horizon=2/);
    const primary = page.getByRole("navigation", { name: "Primary" });
    await primary.getByRole("button", { name: /^Forecast/ }).click();                             // V4 shell: Forecast Intelligence menu
    await primary.getByRole("link", { name: /AI Forecast Lab/ }).click();
    await expect(page).toHaveURL(/\/lab\/\?.*horizon=2/);
    await page.getByRole("radio", { name: "4 weeks", exact: true }).first().click();
    await expect(page).toHaveURL(/\/lab\/\?.*horizon=4/);
    await page.goBack();
    await expect(page).toHaveURL(/\/command\/\?.*horizon=2/);
    await expect(page.getByText(/How reliable at 2 weeks/)).toBeVisible({ timeout: 20_000 });
    await page.goForward();
    await expect(page).toHaveURL(/\/lab\/\?.*horizon=4/);
    await expect(page.getByRole("radio", { name: "4 weeks", exact: true }).first()).toHaveAttribute("aria-checked", "true");
  });

  test("deep links restore ward, origin and horizon; reset returns to the demo default", async ({ page }) => {
    await page.goto("/lab/?ward=GCC_Ward_01&origin=2023-08-07&horizon=4&nointro");
    await expect(page.getByLabel("Ward", { exact: true })).toHaveValue("GCC_Ward_01", { timeout: 20_000 });
    await expect(page).toHaveURL(/ward=GCC_Ward_01/);
    await expect(page).toHaveURL(/horizon=4/);
    await page.getByRole("button", { name: "Reset demo" }).click();
    await expect(page).toHaveURL(/ward=DNCC_Ward_19/);
  });

  test("rainfall what-if re-runs the model and lists the inputs it changed", async ({ page }) => {
    await page.goto("/lab/?ward=DNCC_Ward_19&origin=2024-07-15&horizon=4&nointro");
    await page.getByRole("button", { name: "Run scenario" }).click();
    await expect(page.getByText(/Model inputs changed: rain_tl2/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Not a causal effect/).first()).toBeVisible();
  });

  test("alert review queue is a labelled local draft and exports a log", async ({ page }) => {
    await page.goto("/response/?nointro");
    await expect(page.getByText("Alert review queue (local draft)")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/nothing is sent to field teams/)).toBeVisible();
    const sel = page.getByLabel(/Review status for/).first();
    await sel.selectOption("reviewed");
    await expect(page.getByText(/1<\/b>|of \d+ alerts reviewed/).first()).toBeVisible();
    const dl = page.waitForEvent("download"); await page.getByRole("button", { name: "Export review log (CSV)" }).click();
    expect((await dl).suggestedFilename()).toMatch(/alert_review/);
  });

  test("phone charts wrap their legends instead of paging them", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/command/?nointro");
    await expect(page.locator("main canvas").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText(/^1\/[23]$/)).toHaveCount(0);
  });

  for (const route of ["/", "/command/", "/wards/", "/geography/", "/lab/", "/response/", "/copilot/", "/evidence/"]) {
    test(`${route} has no serious or critical axe (WCAG 2 A/AA) violations at rest`, async ({ page }) => {
      await page.goto(route + "?nointro");
      await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(3000);                                                               // charts, maps and markers settle
      await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });
      const res: any = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
      const bad = res.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious").map((v: any) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`);
      expect(bad).toEqual([]);
    });
  }
});

test.describe("V3.5 landing", () => {
  for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`first screen explains the product and shows the real API forecast at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto("/?nointro");
      const truth = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=3`)).forecast;
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Dengue forecasts");
      const median = page.getByTestId("preview-median");
      await expect(median).toHaveText(String(truth.median_cases), { timeout: 20_000 });               // not a decorative number
      const preview = page.getByTestId("forecast-preview");
      await expect(preview).toContainText(`${truth.lower_80}-${truth.upper_80}`);
      await expect(preview).toContainText("synthetic ward");
      await expect(preview).toContainText("Validated replay (out-of-time)");
      const b = (await median.boundingBox())!;
      expect(b.y + b.height).toBeLessThan(vp.height);                                                // real forecast above the fold
      await expect(preview.getByRole("link", { name: /Open the full forecast/ })).toBeVisible();         // one obvious next action
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
    });
  }

  test("horizon and ward switches re-query the model and update the URL", async ({ page }) => {
    await page.goto("/?nointro");
    const preview = page.getByTestId("forecast-preview");
    await expect(page.getByTestId("preview-median")).toBeVisible({ timeout: 20_000 });
    await preview.getByRole("radio", { name: "4 weeks" }).click();
    const h4 = (await api(page, `/api/forecast?ward_id=${WARD}&origin=${ORIGIN}&horizon=4`)).forecast;
    await expect(page.getByTestId("preview-median")).toHaveText(String(h4.median_cases));
    await expect(page).toHaveURL(/horizon=4/);
    await preview.getByLabel("Ward").selectOption("GCC_Ward_02");
    const g = (await api(page, `/api/forecast?ward_id=GCC_Ward_02&origin=${ORIGIN}&horizon=4`)).forecast;
    await expect(preview).toContainText("GCC_Ward_02");
    await expect(page.getByTestId("preview-median")).toHaveText(String(g.median_cases));
  });

  test("calls to action open the real tools with the selection; old deep links still work", async ({ page }) => {
    await page.goto("/?ward=GCC_Ward_01&origin=2023-08-07&horizon=4&nointro");
    await expect(page.getByTestId("forecast-preview")).toContainText("GCC_Ward_01", { timeout: 20_000 });
    await page.getByTestId("forecast-preview").getByRole("link", { name: /Open the Forecast Lab/ }).click();
    await expect(page).toHaveURL(/\/lab\/\?ward=GCC_Ward_01&origin=2023-08-07&horizon=4/);
    await page.goBack();
    await page.getByTestId("forecast-preview").getByRole("link", { name: /Open the full forecast/ }).click();
    await expect(page).toHaveURL(/\/command\/\?ward=GCC_Ward_01/);
    await expect(page.getByRole("heading", { name: "Command Center", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Ward", { exact: true })).toHaveValue("GCC_Ward_01");
    await page.goto("/?nointro");
    await page.getByRole("link", { name: "See how reliable it is" }).first().click();
    await expect(page).toHaveURL(/\/evidence\//);
  });

  test("forecast outage shows an honest unavailable state, never invented numbers", async ({ page }) => {
    await page.route("**/api/forecast?*", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "down" }) }));
    await page.goto("/?nointro");
    await expect(page.getByTestId("forecast-preview").getByRole("alert")).toContainText(/not responding/, { timeout: 20_000 });
    await expect(page.getByTestId("preview-median")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("decorative motion stops under reduced motion; emergency help, privacy and AI disclosure are on the page", async ({ page }) => {
    await page.goto("/?nointro");                                                                    // config default: reducedMotion "reduce"
    await expect(page.getByTestId("preview-median")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("canvas[data-rainfield]")).toHaveAttribute("data-static", "true");                          // rain drawn once, not animated
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".wire-track")!).animationName)).toBe("none");   // the ward wire stands still
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#land-title")!).opacity)).toBe("1");          // nothing waits on an entrance animation
    const footer = page.getByRole("contentinfo", { name: "Site" });
    await expect(footer.getByRole("link", { name: "999" })).toHaveAttribute("href", "tel:999");
    await expect(footer).toContainText("Privacy");
    await expect(footer).toContainText("AI and tool disclosure");
    await expect(footer).toContainText("Not affiliated with or endorsed by DGHS");
  });

  test("navigation: Overview and Command Center are separate, grouped entries", async ({ page }) => {
    await page.goto("/command/?nointro");
    const section = page.getByRole("navigation", { name: "Section" });                            // V4 context bar: pages of the current group
    await expect(section.getByRole("link", { name: "Command Center" })).toHaveAttribute("aria-current", "page");
    await section.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?|$)/);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: /^Command/ }).click();
    await expect(nav.getByRole("link", { name: /Command Center/ })).toBeVisible();
  });
});

test.describe("V3.5 keyboard and dialogs", () => {
  test("keyboard: skip link comes first, and Tab reaches the landing calls to action and the forecast preview", async ({ page }) => {
    await page.goto("/?nointro");
    await expect(page.getByTestId("preview-median")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to content");
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); seen.push(((await page.locator(":focus").getAttribute("aria-label")) ?? (await page.locator(":focus").innerText().catch(() => ""))).trim()); }
    expect(seen.some((x) => /Open the Command Center/.test(x))).toBe(true);
    expect(seen.some((x) => /^3 weeks$/.test(x))).toBe(true);                                          // horizon switch in the preview
    expect(seen.some((x) => /Open the full forecast/.test(x))).toBe(true);
  });

  test("dialogs keep focus inside, close on Escape and return focus to the opener", async ({ page }) => {
    await page.goto("/command/?nointro");
    const opener = page.getByRole("button", { name: "DengueShield Copilot" });
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "DengueShield Copilot" });
    await expect(drawer).toBeVisible();
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);               // Tab never leaves the drawer
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await page.goto("/response/?nointro");
    await page.getByRole("table").first().getByRole("row").nth(1).click({ timeout: 20_000 });
    const dlg = page.getByRole("dialog");
    await expect(dlg).toContainText("Nothing here is sent to anyone");
    await expect(dlg.getByRole("link", { name: /Open in Command Center/ })).toHaveAttribute("href", /\/command\/\?ward=/);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  });
});

test.describe("V3.5 colour modes", () => {
  test("Light ↔ Dim toggle applies immediately and persists across reloads", async ({ page }) => {
    await page.goto("/command/?nointro");
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: /Colour mode: Light/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dim");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(15, 16, 51)");   // MicroFire deep navy, not black
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dim");                                        // remembered, applied before paint
    await page.getByRole("button", { name: /Colour mode: Dim/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  for (const route of ["/", "/command/", "/lab/", "/evidence/", "/response/", "/geography/", "/wards/", "/copilot/"]) {
    test(`Dim mode: ${route} has no serious or critical axe violations (incl. contrast)`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("ds.theme", "dim"));
      await page.goto(route + "?nointro");
      await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(3000);
      await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });
      const res: any = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
      const bad = res.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious").map((v: any) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")).join(" | ")}`);
      expect(bad).toEqual([]);
    });
  }
});

test("Model Evidence: comparison explorer shows saved results, the champion, separated non-model evidence and a CSV download", async ({ page }) => {
  await page.goto("/evidence/?nointro");
  await page.getByRole("tab", { name: "Model comparison" }).click();
  const d = await api(page, "/api/model/comparison");
  const champ = (w: string) => d.rows.find((r: any) => r.model === "glm_poisson" && r.feature_set === "F8" && !r.variant_tag && r.window === w && r.horizon === "2-4 mean");
  await expect(page.getByText("How do the models compare?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`(${champ("2019-2024").mae.toFixed(3)} MAE here)`)).toBeVisible();          // the same number the API serves
  await expect(page.locator("main canvas").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Download comparison CSV" })).toHaveAttribute("href", "/api/model/comparison.csv");
  await expect(page.getByText(/hyperparameter trials/)).toBeVisible();                                    // trials are listed apart from models
  await expect(page.getByText(/SARIMA was not run/)).toBeVisible();
  await page.getByRole("radio", { name: /Selection seasons/ }).click();
  await expect(page.getByText(`(${champ("2022-2024").mae.toFixed(3)} MAE here)`)).toBeVisible();
  await expect(page.getByText(/Development validation used in model selection: not a blind test/)).toBeVisible();   // never presented as a blind test
  await expect(page.getByText(/not a confidence interval/)).toBeVisible();                                 // ±0.05 is a selection tolerance
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js" });
  const res: any = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
  expect(res.violations.filter((v: any) => v.impact === "critical" || v.impact === "serious").map((v: any) => v.id)).toEqual([]);
});
