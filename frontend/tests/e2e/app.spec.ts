import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/profiling/", "/wards/", "/geography/", "/lab/", "/copilot/", "/evidence/", "/response/", "/climate/", "/learn/", "/provenance/"];
const WARD = "DNCC_Ward_19", ORIGIN = "2024-08-05";
const IGNORE = /Failed to load resource|ERR_ABORTED|WebGL|GPU stall|tile|maptiler|WebSocket/i;

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

// ---- Geography (DGHS official boundaries). The success case uses a MOCK payload with invented attributes (a test fixture, not DGHS data).
const GEO_FIXTURE = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { dist_name: "MockDistrict", city_name: "MockCity", ward_no: 1 }, geometry: { type: "Polygon", coordinates: [[[90.3, 23.7], [90.4, 23.7], [90.4, 23.8], [90.3, 23.7]]] } },
  { type: "Feature", properties: { dist_name: "MockDistrict", city_name: "MockCity", ward_no: 2 }, geometry: { type: "Polygon", coordinates: [[[90.4, 23.7], [90.5, 23.7], [90.5, 23.8], [90.4, 23.7]]] } }],
  dghs: { count: 2, pages: 1, truncated: false, max_features: 3000, cache: { cached: false, stale: false }, attribution: "MOCK attribution text", license: "MOCK licence text",
          detected_fields: { district: { name: "dist_name" }, city: { name: "city_name" }, ward: { name: "ward_no" } } } };

test("Geography: boundaries are context only and predictions stay in the abstract matrix", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/geo/dghs/status", (r) => r.fulfill({ json: { status: "ok", attribution: "MOCK attribution text", license: "MOCK licence text", id_mapping: { status: "unmapped", verified: false, reason: "No crosswalk." }, detected_fields: GEO_FIXTURE.dghs.detected_fields } }));
  await page.route("**/api/geo/dghs/filters*", (r) => r.fulfill({ json: { options: { district: ["MockDistrict"], city: ["MockCity"], ward: [1, 2] }, detected_fields: GEO_FIXTURE.dghs.detected_fields } }));
  await page.route("**/api/geo/dghs/wards*", (r) => r.fulfill({ json: GEO_FIXTURE }));
  await page.goto("/geography/");
  await expect(page.getByText("2 features")).toBeVisible();
  await expect(page.getByText("MOCK attribution text").first()).toBeVisible();
  await expect(page.getByText("not linked to forecasts").first()).toBeVisible();
  await expect(page.getByText(/No verified crosswalk exists/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^DNCC_Ward_\d+ / }).first()).toBeVisible();      // abstract matrix of synthetic wards
  await expect(page.getByRole("cell", { name: "MockCity" }).first()).toBeVisible();                  // attributes shown exactly as published
  await expect(page.locator("main canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Geography degrades gracefully when the DGHS GIS service is unreachable", async ({ page }) => {
  await page.route("**/api/geo/dghs/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "unavailable", error: "ConnectTimeout: simulated", id_mapping: { verified: false } }) }));
  await page.goto("/geography/");
  await expect(page.getByText(/Optional service unavailable/)).toBeVisible();
  await expect(page.getByText(/Boundary data is unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^DNCC_Ward_\d+ / }).first()).toBeVisible();      // predictions unaffected
});
