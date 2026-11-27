// Stage 4 kill-switch workflow. Runs only inside scripts/killswitch.sh (OFFLINE_E2E=1), where the internet is cut off and loopback works.
// Plain Playwright (no fixture stubs): any external request genuinely fails. Every UI number is checked against the local API.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = process.env.KILLSWITCH_OUT ?? "../killswitch";
const Q = "origin=2024-08-05&horizon=3";
test.skip(process.env.OFFLINE_E2E !== "1", "kill-switch workflow: run through scripts/killswitch.sh with the internet cut off");

test("with the internet cut off: forecast, supplies, hospital, vector control and dispatch all work", async ({ page, context }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const attempted = new Set<string>(), delivered: string[] = [];
  const local = (u: string) => { try { const h = new URL(u).hostname; return h === "127.0.0.1" || h === "localhost"; } catch { return true; } };
  page.on("request", (r) => { if (r.url().startsWith("http") && !local(r.url())) attempted.add(new URL(r.url()).hostname); });
  page.on("requestfinished", (r) => { if (r.url().startsWith("http") && !local(r.url())) delivered.push(r.url()); });
  const api = (path: string) => page.evaluate(async (p) => (await fetch(p)).json(), path);
  const steps: string[] = [];
  const shot = async (name: string, sel: string) => { await page.locator(sel).screenshot({ path: `${OUT}/${name}.png` }); };

  // 0. the browser itself cannot reach the internet
  await page.goto("/?nointro");
  expect(await page.evaluate(async () => { try { await fetch("https://example.com/", { mode: "no-cors", cache: "no-store" }); return true; } catch { return false; } })).toBe(false);
  steps.push("browser cannot reach example.com");

  // 1-3. the offline app opens and forecasts at 2, 3 and 4 weeks
  for (const h of [2, 3, 4]) {
    await page.goto(`/command/?ward=DSCC_Ward_04&origin=2024-08-05&horizon=${h}&nointro`);
    await expect(page.getByTestId("answer-card")).toBeVisible({ timeout: 60_000 });
  }
  await page.goto(`/response/?${Q}&nointro`);
  await expect(page.getByTestId("offline-chip")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#priority").getByRole("row").filter({ hasText: /_Ward_/ }).first()).toBeVisible({ timeout: 60_000 });
  steps.push("forecasts at 2, 3 and 4 weeks; offline chip shown");

  // 4-5. stock scarcity: the allocation recomputes and matches the local API
  const supply = page.locator("#supply");
  await supply.getByLabel("Regional stock").fill("40");
  const a40 = await api(`/api/allocation/plan?${Q}&stock=0.4`);
  const t = a40.totals.saline_bags_needed;
  await expect(supply.getByText(`of ${t.demand} needed; supply ${t.supply}; short ${t.unmet}`)).toBeVisible({ timeout: 30_000 });
  await shot("offline_supply", "#supply");
  steps.push(`supply at 40% stock: saline ${t.allocated}/${t.demand}`);

  // 6-7. hospital overflow, then more illustrative capacity
  const surge = page.locator("#surge");
  const o100 = await api(`/api/overflow/plan?${Q}`);
  await expect(surge.getByRole("alert")).toContainText(`${o100.totals.unresolved} projected patients`, { timeout: 30_000 });
  await surge.getByRole("radio", { name: "+20% surge beds" }).click();
  const o120 = await api(`/api/overflow/plan?${Q}&capacity_pct=120`);
  await expect(surge.getByRole("alert")).toContainText(`${o120.totals.unresolved} projected patients`, { timeout: 30_000 });
  await expect(surge.getByRole("table").first().locator("tbody tr")).toHaveCount(o120.transfers.length);
  await expect(surge.locator("svg path.ops-draw")).toHaveCount(o120.transfers.length);   // the ward transfer network draws offline, link for link
  await shot("offline_hospital", "#surge");
  steps.push(`hospital: ${o100.totals.unresolved} without a bed at baseline, ${o120.totals.unresolved} with +20% beds and ${o120.totals.transferred} transfers`);

  // 8-9. optimized spraying crews and the 2-4 week simulator
  const vec = page.locator("#vector");
  const v = await api(`/api/intervention/simulate?${Q}&capacity_pct=120&stock=0.4`);
  await expect(vec.getByTestId("prevented-total")).toHaveText(v.totals.prevented_window.toFixed(1), { timeout: 30_000 });
  await vec.getByRole("tab", { name: "Hospital" }).click();
  await expect(vec.getByRole("tabpanel")).toContainText(`${v.hospital.totals.baseline.unresolved} → ${v.hospital.totals.scenario.unresolved}`);
  await shot("offline_vector", "#vector");
  steps.push(`vector control: ${v.totals.prevented_window.toFixed(1)} cases prevented over weeks 2-4 (assumed effect)`);

  // 10. SMS and WhatsApp notices
  const desk = page.locator("#dispatch");
  await expect(desk.getByTestId("sms-text")).toContainText("Ref S-", { timeout: 30_000 });
  const sid = (await desk.getByTestId("scenario-id").innerText()).trim();
  await desk.getByRole("button", { name: "Copy SMS" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`Ref ${sid}`);
  await desk.getByRole("button", { name: "Copy WhatsApp" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("*DengueShield planning notice*");
  await shot("offline_dispatch", "#dispatch");
  steps.push(`SMS and WhatsApp copied for scenario ${sid}`);

  // 11. download and check the PDF brief
  const dl = page.waitForEvent("download");
  await desk.getByRole("button", { name: "Download this ward as PDF" }).click();
  const file = await dl;
  await file.saveAs(`${OUT}/offline_brief.pdf`);
  const pdf = Buffer.from(await (await import("node:fs/promises")).readFile(`${OUT}/offline_brief.pdf`)).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  const xref = Number(pdf.slice(pdf.lastIndexOf("startxref") + 9).trim().split(/\s/)[0]);
  expect(pdf.slice(xref, xref + 4)).toBe("xref");
  expect(pdf).toContain(sid);
  steps.push(`PDF brief saved (${pdf.length} bytes), structure checked, scenario ${sid}`);

  // 10b-11b. Bangla notice and Bangla HTML brief carry the same scenario id as the SMS, the PDF and the snapshot
  await desk.getByRole("radio", { name: "বাংলা" }).click();
  await expect(desk.getByTestId("sms-text")).toContainText("ডেঙ্গুশিল্ড");
  await expect(desk.getByTestId("sms-stats")).toContainText("UCS-2");
  await desk.getByRole("button", { name: "Copy SMS" }).click();
  const bn = await page.evaluate(() => navigator.clipboard.readText());
  expect(bn).toContain(sid);
  const dlh = page.waitForEvent("download");
  await desk.getByRole("button", { name: "Download this ward as HTML" }).click();
  const fh = await dlh;
  await fh.saveAs(`${OUT}/offline_brief_bn.html`);
  const html = (await import("node:fs")).readFileSync(`${OUT}/offline_brief_bn.html`, "utf-8");
  expect(html).toContain("<html lang=bn>");
  expect(html).toContain(sid);
  expect(file.suggestedFilename()).toContain(sid);
  expect(fh.suggestedFilename()).toContain(sid);
  steps.push(`Bangla SMS (UCS-2) and Bangla HTML brief: same scenario ${sid} as the English SMS, the PDF and the snapshot`);

  // status: offline mode, artifacts, nothing refused; the footer shows the build commit
  const st = await api("/api/system/offline");
  expect(st.offline_mode && st.artifacts_ok).toBe(true);
  expect(st.blocked_count).toBe(0);
  await page.goto("/?nointro");                                                                 // the footer (with the build) is on the landing page
  await expect(page.getByTestId("build-commit")).toHaveText(st.build_commit, { timeout: 30_000 });
  steps.push(`server offline mode on, ${st.artifacts.length} artifacts and modules present, 0 refused connections, build ${st.build_commit}`);

  // 12. nothing external was delivered; record what the page tried
  expect(delivered).toEqual([]);
  writeFileSync(`${OUT}/browser.json`, JSON.stringify({ steps, scenario_id: sid, build_commit: st.build_commit, external_hosts_attempted: [...attempted].sort(), external_delivered: delivered }, null, 1));
});
