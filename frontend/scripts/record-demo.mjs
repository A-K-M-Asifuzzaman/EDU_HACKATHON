// Uncut demo recorder: ONE continuous browser take of the live site (no cuts, no slides), paced to cue times.
//   node scripts/record-demo.mjs                      -> preview take on the default cues
//   DEMO_AUDIO=voice.m4a node scripts/record-demo.mjs -> cues taken from the voice's section pauses, voice muxed in
// Env: DEMO_URL (default deployed site), DEMO_OUT (output folder), DEMO_CUES (JSON file overriding cue seconds).
import { chromium } from "@playwright/test";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execFileSync, spawnSync } from "node:child_process";

const BASE = process.env.DEMO_URL ?? "https://dengueshield-ai.vercel.app";
const OUT = process.env.DEMO_OUT ?? path.join(os.homedir(), "Desktop", "DengueShield_demo");
const SCENES = ["intro", "inputs", "predictions", "drivers", "change", "wards", "evidence", "map", "emergency", "sandbox", "bangla", "end"];
let cues = { intro: 0, inputs: 7, predictions: 30, drivers: 53, change: 73, wards: 85, evidence: 99, map: 121, emergency: 151, sandbox: 161, bangla: 172, end: 178 };
fs.mkdirSync(OUT, { recursive: true });

// --- voice -> cues: speaker leaves a ~2 s pause between the 11 sections; long pauses are shortened to 0.7 s
let voice = null;
if (process.env.DEMO_AUDIO) {
  const src = process.env.DEMO_AUDIO;
  const txt = spawnSync("ffmpeg", ["-hide_banner", "-i", src, "-af", `silencedetect=noise=${process.env.DEMO_NOISE ?? "-35dB"}:d=1.2`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...txt.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]), ends = [...txt.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString();
  // speech segments = complement of silences
  const segs = []; let t = 0;
  starts.forEach((s, i) => { if (s - t > 0.3) segs.push([t, s]); t = ends[i] ?? dur; });
  if (dur - t > 0.3) segs.push([t, dur]);
  const n = SCENES.length - 1;
  if (segs.length !== n) throw new Error(`found ${segs.length} spoken sections, expected ${n}; pause ~2 s between sections (segments: ${JSON.stringify(segs.map((s) => s.map((x) => +x.toFixed(1))))})`);
  const LEAD = 0.35, GAP = 0.7; // keep a short breath before each section
  const parts = []; let cursor = 0;
  segs.forEach(([a, b], i) => { cues[SCENES[i]] = +cursor.toFixed(2); parts.push([Math.max(0, a - LEAD), Math.min(dur, b + LEAD)]); cursor += (Math.min(dur, b + LEAD) - Math.max(0, a - LEAD)) + (i < n - 1 ? GAP : 0); });
  cues.end = +(cursor + 1.0).toFixed(2);
  const filt = parts.map(([a, b], i) => `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS${i < n - 1 ? `,apad=pad_dur=${GAP}` : ""}[a${i}]`).join(";") + ";" + parts.map((_, i) => `[a${i}]`).join("") + `concat=n=${n}:v=0:a=1[out]`;
  voice = path.join(OUT, "voice_tight.wav");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-filter_complex", filt, "-map", "[out]", voice]);
  console.log("cues from voice:", cues);
  if (cues.end > 180) console.warn(`WARNING: voice is ${cues.end.toFixed(1)} s, over the 3:00 limit`);
}
if (process.env.DEMO_CUES) cues = { ...cues, ...JSON.parse(fs.readFileSync(process.env.DEMO_CUES, "utf8")) };

// --- warm the backend so the take has no cold-start waits
for (const u of ["/api/health", "/api/forecast?ward_id=DNCC_Ward_19&origin=2024-08-05&horizon=3", "/api/decision/allocation-season?year=2024&horizon=3&teams=10", "/api/routing/status", "/api/model/diagnostics"])
  await fetch(BASE + u).catch(() => {});

const [W, H, DSF] = process.env.DEMO_LARGE === "0" ? [1600, 900, 1.2] : [1280, 720, 1.5]; // both give 1920x1080 frames; the default renders text 25% larger
const browser = await chromium.launch({ headless: process.env.DEMO_HEADED !== "1", args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, geolocation: { latitude: 23.7104, longitude: 90.4074 }, permissions: ["geolocation"], locale: "en-US", timezoneId: "Asia/Dhaka" });
// visible presenter cursor (headless has none)
await ctx.addInitScript(() => addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;z-index:2147483647;left:-40px;top:-40px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(250,204,21,.45);border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);pointer-events:none;transition:transform .12s";
  document.documentElement.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => (c.style.transform = "scale(.65)"), true);
  addEventListener("mouseup", () => (c.style.transform = ""), true);
}));
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
// the take starts once the intro and its 3D mosquito are on screen, not on a loading page
await page.getByRole("dialog", { name: /introduction/ }).waitFor({ timeout: 30_000 }); await page.waitForTimeout(2500);

// --- screencast: every composited frame with its timestamp
const FR = fs.mkdtempSync(path.join(os.tmpdir(), "ds-frames-")), frames = [];
const cdp = await ctx.newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const f = path.join(FR, `${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(f, Buffer.from(data, "base64")); frames.push({ f, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W * DSF, maxHeight: H * DSF });
const T0 = Date.now() / 1000, now = () => Date.now() / 1000 - T0;
const late = [];
const at = async (scene, frac = 0) => {
  const i = SCENES.indexOf(scene), t = cues[scene] + (frac ? frac * (cues[SCENES[i + 1]] - cues[scene]) : 0);
  const ms = (t - now()) * 1000; if (ms > 0) await page.waitForTimeout(ms); else if (ms < -400) late.push(`${scene}@${frac}: ${(-ms / 1000).toFixed(1)} s late`);
};

// --- human-like pointer
let mx = W / 2, my = H / 2;
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
async function move(x, y, ms = 650) {
  const x0 = mx, y0 = my, s = Date.now(); // clock-based: a move takes `ms` however slow each mouse event is
  for (let k = 0; k < 1; ) { k = Math.min(1, (Date.now() - s) / ms); const e = ease(k); await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); }
  mx = x; my = y;
}
async function center(loc) { await loc.waitFor({ state: "visible", timeout: 8_000 }); const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function show(loc, block = "center") {
  await loc.waitFor({ state: "attached", timeout: 25_000 });
  await loc.evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block); await page.waitForTimeout(900);
}
async function point(loc, ms) {
  const [x, y] = await center(loc); await move(x, y, ms);
  const b = await loc.boundingBox().catch(() => null); if (!b) return;
  await page.evaluate(({ x, y, w, h }) => { // highlight ring around what the voice is talking about
    const r = document.createElement("div"), p = 6;
    r.style.cssText = `position:fixed;z-index:2147483646;left:${x - p}px;top:${y - p}px;width:${w + 2 * p}px;height:${h + 2 * p}px;border:3px solid #facc15;border-radius:10px;box-shadow:0 0 0 4px rgba(250,204,21,.25);pointer-events:none;opacity:0;transition:opacity .25s`;
    document.documentElement.appendChild(r); requestAnimationFrame(() => (r.style.opacity = "1"));
    setTimeout(() => (r.style.opacity = "0"), 1700); setTimeout(() => r.remove(), 2000);
  }, { x: b.x, y: b.y, w: Math.min(b.width, 900), h: Math.min(b.height, 400) }).catch(() => {});
}
async function click(loc, ms) { await point(loc, ms); await page.waitForTimeout(140); await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); }
async function type(loc, text) { await click(loc); await page.keyboard.type(text, { delay: 75 }); }
const nav = (name) => page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name, exact: true });
const main = page.locator("main");

// ================= the take =================
// 1 intro: chase the mosquito, swat
await at("intro", 0.15); await move(W * 0.62, H * 0.42, 900); await move(W * 0.4, H * 0.55, 800);
await at("intro", 0.75); await move(W * 0.5, H * 0.47, 400); await page.mouse.down(); await page.mouse.up();

// 2 inputs: ward, origin week, horizon
await at("inputs", 0.08); await point(page.getByLabel("Ward", { exact: true }));
await at("inputs", 0.3); await point(page.getByRole("slider", { name: "Forecast origin" }));
await at("inputs", 0.48); await point(page.getByRole("radio", { name: "3 weeks" }));
await at("inputs", 0.62); await show(main.getByText("What drives this forecast").first(), "start").catch(() => {});
await at("inputs", 0.7); await show(main.getByText("Weather context").first(), "center");
await point(main.getByText("Weather context").first(), 500);

// 3 predictions: back to the ward forecast, fan chart, verdict
await at("predictions", 0); await show(main.getByText("Time-machine verdict").first(), "center");
await point(main.getByText("Median cases", { exact: true }).first());
await at("predictions", 0.15); await point(main.getByText(/80% interval/i).first()).catch(() => {});
await at("predictions", 0.3); await point(main.getByText("83%", { exact: true }).first()).catch(() => {});
await at("predictions", 0.42); await point(main.getByText("Critical", { exact: false }).first()).catch(() => {});
await at("predictions", 0.62); await point(main.getByText("Time-machine verdict").first()).catch(() => {});

// 4 drivers + rainfall lag
await at("drivers", 0); await show(main.getByText("What drives this forecast").first(), "start"); await point(main.getByText("What drives this forecast").first());
await at("drivers", 0.5); await show(main.getByText("Which rainfall does this forecast use?").first(), "center"); await point(main.getByText("Which rainfall does this forecast use?").first());

// 5 change inputs + time machine
await at("change", 0); await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await page.waitForTimeout(700);
await click(page.getByRole("radio", { name: "4 weeks" }));
await at("change", 0.3); await click(page.getByRole("radio", { name: "3 weeks" }));
await at("change", 0.45); await click(page.getByRole("button", { name: /Play time machine/ }));
await at("change", 0.95); await click(page.getByRole("button", { name: /Pause time machine/ }), 300).catch(() => {});

// 6 ward risk matrix (heatmap)
await at("wards", 0); await click(nav("Ward Risk Explorer"));
await at("wards", 0.25); await point(main.getByText("Risk matrix").first());
await at("wards", 0.45); const rb = await main.getByText("Risk matrix").first().boundingBox(); // sweep across the Chattogram row of tiles
if (rb) { await move(rb.x + 25, rb.y + 70, 500); await move(rb.x + 340, rb.y + 70, 2200); }

// 7 evidence: MAE per season, coverage at peaks
await at("evidence", 0); await click(nav("Model Evidence"));
await at("evidence", 0.2); await show(main.getByText("Validation by season").first(), "start"); await point(main.getByText("Validation by season").first());
await at("evidence", 0.6); await show(main.getByText("Coverage by incidence severity").first(), "start"); await point(main.getByText("0.607").first()).catch(() => {});

// 8 map: hospital search, A* route verified by Dijkstra, insight, nearest by road
await at("map", 0); await click(nav("Map & Emergency Routing"));
await at("map", 0.12); await click(page.getByRole("button", { name: "Use my location" }));
await at("map", 0.2); await type(page.locator("#geo-search"), "Square Hospital"); await click(page.getByRole("option").first());
const panel = page.getByRole("complementary", { name: /Facility, route/ });
await at("map", 0.38); await click(panel.getByRole("button", { name: /Route from start/ }));
await panel.getByText("Dijkstra check").waitFor({ timeout: 25_000 }).catch(() => {}); await point(panel.getByText("Dijkstra check")).catch(() => {});
await at("map", 0.6); await click(panel.getByRole("switch", { name: /A\* Algorithm Insight/ }));
await panel.getByText(/fewer nodes toward the goal/).waitFor({ timeout: 25_000 }).catch(() => {}); await point(panel.getByText(/fewer nodes toward the goal/)).catch(() => {});
await at("map", 0.82); await click(page.getByRole("button", { name: "Nearest hospitals by road" }));

// 9 emergency help
await at("emergency", 0); await click(page.getByRole("button", { name: /Emergency help/ }).first());
const dlg = page.getByRole("dialog", { name: "Emergency help" });
await at("emergency", 0.25); await point(dlg.locator('a[href="tel:999"]'));
await at("emergency", 0.45); await point(dlg.locator('a[href="tel:16263"]'));
await at("emergency", 0.65); await point(dlg.getByText("severe abdominal pain"));
await at("emergency", 0.92); await page.keyboard.press("Escape");

// 10 Climate Futures (DEMO_FUTURES=1) replaces the resource sandbox
if (process.env.DEMO_FUTURES === "1") {
  await at("sandbox", 0); await click(nav("AI Forecast Lab"));
  const cf = page.getByRole("region", { name: "Climate Futures 2026–2030" });
  await at("sandbox", 0.1); await show(cf.getByText("Exploratory multi-year climate scenario").first(), "start");
  await at("sandbox", 0.22); await click(cf.getByRole("radio", { name: "Wetter (+20% rain)" }).first());
  await at("sandbox", 0.36); await point(cf.getByText(/Median cases · 2026/).first()).catch(() => {});
  await at("sandbox", 0.5); await show(cf.getByText("Multi-year view: history and 2026–2030 scenario").first(), "start"); await point(cf.getByText("Multi-year view: history and 2026–2030 scenario").first()).catch(() => {});
  await at("sandbox", 0.75); await show(cf.getByText("Season-ahead backtest (2019–2024)").first(), "center"); await point(cf.getByText("M0 climatology").first()).catch(() => {});
} else {
// 10 resource planning sandbox
await at("sandbox", 0); await click(nav("Response Intelligence"));
await at("sandbox", 0.15); const sb = main.getByText("Planning simulation, not a deployment recommendation.").first(); await show(sb, "start");
await at("sandbox", 0.3); await point(main.getByText(/share of actual outbreak ward-weeks/).first()).catch(() => {});
await at("sandbox", 0.6); await point(main.getByText("Forecast alert priority").first()).catch(() => {});

}

// 11 Bangla
await at("bangla", 0); await click(page.getByRole("button", { name: "Switch language" }), 500);
await at("end", 0);

await cdp.send("Page.stopScreencast"); const END = now() + T0;
await browser.close();

// --- frames -> constant 30 fps H.264 (each frame held until the next one arrived)
const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t : END) - (i === 0 ? T0 : fr.t)).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1).f}'\n`;
fs.writeFileSync(path.join(FR, "list.txt"), list);
const video = path.join(OUT, voice ? "dengueshield_demo_silent.mp4" : "dengueshield_demo_preview.mp4");
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(FR, "list.txt"), "-vf", "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", video]);
if (voice) {
  const fin = path.join(OUT, "dengueshield_demo_final.mp4");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", video, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", fin]);
  console.log("final:", fin);
}
fs.writeFileSync(path.join(OUT, "cues_used.json"), JSON.stringify(cues, null, 1));
fs.rmSync(FR, { recursive: true, force: true });
console.log(`video: ${video}  frames: ${frames.length}  length: ${(END - T0).toFixed(1)} s`);
console.log(late.length ? "LATE steps:\n  " + late.join("\n  ") : "all steps on cue");
