# DengueShield AI V4: redesign report

26 Nov 2026. Working copy `/Volumes/ssd(mac)2/EDU_HACKATHON_V3`. On the owner's instruction ("push in edu Hackathon final repo
only so my teammate can work on this") the work was committed on a new branch `v4-microfire-redesign` and pushed to the private
repository EDU_HACKATHON_FINAL only; its `main` and the original EDU_HACKATHON repository were not touched. Nothing was merged or deployed. No paid API was called (test servers run with `OPENAI_BASE_URL=http://127.0.0.1:9`).
The 2025 holdout stays sealed; the champion model and all ML artifacts are unchanged.

## 1. What the owner asked for, in order

1. V4 Signal Atlas and the cinematic boot and loading system.
2. "Stop making it look AI-generated": editorial, restrained, data as imagery.
3. "Make it fancy", "100x premium all over".
4. Ultra-premium correction with the Abhas site as a minimum benchmark, plus the named design skills.
5. Adopt the owner's NASA Space Apps 2026 MicroFire theme (live reference https://microfire-v2-preview.vercel.app/).

The final state is round 5 built on the structure of rounds 2 to 4: MicroFire v2's visual language (cobalt bands, Bricolage Grotesque
800, Atkinson Hyperlegible Next, yellow pill actions with navy outlines and hard shadows, white outlined cards) applied to the
"Monsoon Intelligence" product story with real data as every visual. The system is documented in `DESIGN.md` at the repo root.

## 2. Implemented and verified

**Design system** (`DESIGN.md`, `frontend/app/globals.css`, `components/ui.tsx`)
- Tokens for Light (lavender), Dim (deep navy) and cobalt bands (`.night`, applied to the header, landing hero, every page masthead and
  the Command band). White cards inside bands reset to light tokens. Fonts self-hosted and pinned (Bricolage Grotesque 5.2.10, Atkinson
  Hyperlegible Next 5.2.6); Space Grotesk, Inter, Newsreader, Orbitron and Exo 2 removed.
- Atoms: buttons, cards, segmented controls, tabs, status tags, risk badges, statistics, page masthead, `ActionProgress`.
- Colour roles: action yellow; model cobalt (yellow on bands); rain teal; outbreak and emergency red; risk tiers always with words.

**Landing** (`app/page.tsx` and new components)
- Hero: data-driven rain atmosphere (`rain-field.tsx`, density = rainfall observed in the selected ward and issue week, stated on
  the page), heavy two-line headline, live readout with the rain → risk instrument (`rain-risk.tsx`: observed rain, the rain weeks the
  model reads, typical rain for weeks not yet fallen, and the 2/3/4-week forecasts as uncertainty candles; candles select the horizon).
- The wire: all 60 wards' forecasts as one moving strip (`ward-wire.tsx`; pauses on hover/focus, still under reduced motion).
- Chapters 01 to 06: the rain signal (lag diagram), the forecast window (`season-figure.tsx`, the whole replayed season with the issue
  line, keyboard and pointer reading, select a week), the model's evidence (the honest weakness as a 56% figure, reliability table,
  `model-strip.tsx` with all 43 configurations, champion and the 0.05 selection tolerance labelled as a decision rule), from risk to
  response (`risk-field.tsx` skyline of 60 synthetic wards, never on a real map), geospatial navigation (`facility-map.tsx` city-lights
  map of 914 real facilities), scientific trust (limits, sealed test year, hashes); tools index.

**Command Center** (`app/command/page.tsx`, `components/forecast-instrument.tsx`)
- Cockpit: cobalt band with one dominant instrument (readout, reliability, rain → risk, time-machine verdict, next steps); on lavender:
  the season, all 60 wards (statistics, ranked table, skyline), drivers with rain-week table, limitations, one recommended next step.
- Phones: the forecast is in the first screen (median label at 640 px on a 360×740 screen).

**Boot sequence** (`components/intro.tsx`, `introscene.tsx`, new `aedes.tsx`)
- Procedural *Aedes aegypti* (lyre marking, banded abdomen and tarsi, raised hind legs, veined iridescent wings), monsoon rain on cobalt,
  pointer curiosity and dodge, swat by click/tap/Enter/Space, raindrop ripples, short shake, radial reveal into the cobalt hero.
  Skip, Emergency help, muted-by-default sound, once per session, reduced-motion skip, SVG fallback without WebGL or on low-end devices.

**Every other page** (Lab, Wards, Evidence incl. the Model Comparison Explorer, Response, Geography, Climate, Copilot, Profiling, Learn,
Provenance): cobalt masthead, MicroFire components and type through the shared atoms; Copilot hero and Learn 3D stage recoloured.

**Loading and failure system** (`lib/api.ts`, `components/ui.tsx`)
- Request timeout 20 s, in-flight dedup, retry with backoff (1.5 s, 4 s) on network/timeout/5xx only, abort-based stale protection,
  "taking longer" after 2.5 s, honest failure panels with Try again, service-health pill in the header, labelled skeletons on every
  request-driven panel, map slow-start and tile-failure notices, abortable route/nearest searches with elapsed time and Cancel, Copilot
  45 s inactivity watchdog and slow-wait hint. No percentages, no invented success.

## 3. Verification (all on the final build)

| Check | Result |
|---|---|
| Python suite | 335 passed (baseline 334 + 1 new model-comparison test) |
| Playwright, no retries | 85 passed (baseline 69 + 16 new V4 chaos tests) |
| V4 chaos tests | forecast delayed 0.5 / 2 / 5 / 15 s; landing slow at 360/390/430/768/1440 px; 500 with backoff then recovery; 503 labelled failure; offline then recovery; rapid horizon switching (no stale answer); route search cancel; basemap tile failure |
| axe WCAG 2 A/AA serious+critical | 0 on 12 routes at 390 and 1440 px, Light and Dim |
| Horizontal overflow | none at 360, 390, 430, 768, 1024, 1440, 1920 px |
| Core Web Vitals (3 runs, desktop and mobile at 4× CPU) | LCP ≤ 0.97 s, CLS ≤ 0.068, Command time-to-forecast on mobile 576 ms (V3.5: 889 ms) |
| Original release `/Volumes/ssd(mac)2/EDU_HACKATHON` | unchanged: 938ff3b, 13 status entries |

Performance detail (V3.5 → V4, LCP ms / JS gzip KB): desktop landing 152→512 / 151→173, Command 220→120 / 174→167; mobile landing
424→796 / 119→126, Command 516→532 / 127→115. The landing is heavier because it now renders real data components; all values stay
inside "good".

## 4. Partial, deferred or needing a decision

- **Logo:** the gradient shield was flattened (ink/white shield, paper drop) to fit the system. A brand mark change needs owner approval.
- **Page-specific recomposition:** Landing, Command Center and the boot sequence were recomposed individually. The other pages received
  the MicroFire masthead, components and type through the shared system, but their internal layouts (card grids) were not each
  redesigned. Next candidates: Lab (workbench with the season figure and rain controls), Evidence (research terminal), Geography.
- **ECharts colours** on Lab, Evidence, Climate and Profiling still use the earlier validated categorical palette, not yet re-tuned to
  MicroFire.
- **Atkinson Hyperlegible Next** draws a slashed zero ("2Ø24"). It is the font's legibility design and the MicroFire reference uses it.
- **Design references:** the awesome-claude-design `DESIGN.md` examples (Linear, Stripe and others) could not be opened (WebFetch
  permission denied for getdesign.md); only the repository README's structure was used. ECC was read from its local cache, not enabled.
- **Abhas** was used only as a benchmark (screenshots in `screenshots/v4_after/benchmark_abhas_1440.png`); nothing was copied.
- **Eligibility:** owner-confirmed on 25 Nov ("Eligibility is confirmed"); no organizer rules document was found or verified.

## 5. Files and snapshots

- `snapshots/v4.patch` (tracked changes; 104 files, +12,315 / -1,287) and `snapshots/v4_untracked.tgz` (12 new files).
- `MODIFIED_FILES_V4.md` (full list). Pre-V4 states: `snapshots/v3_5.patch`, `snapshots/v4_pre.patch`.
- Screenshots: `screenshots/v4_after/` (37 captures: every page desktop and mobile, Dim, landing chapters, boot sequence, references);
  before: `screenshots/v3_5_after/` and `screenshots/v3_5_before/`.

## 6. Demo guide (local)

1. Open http://127.0.0.1:8200/ in a fresh tab: swat the mosquito (or press Enter), watch the page open from the impact point.
2. In the hero, switch the horizon or click a forecast candle; change the ward and watch the rain density, readout and wire update.
3. Scroll the six chapters; in chapter 02 move along the season and click a week to make it the forecast.
4. Open the Command Center: the cockpit band, the time-machine verdict, the ward table and skyline, the weekly situation report.
5. Map: "Use my location", pick a hospital, route (Cancel works while it searches). Model Evidence: the comparison explorer.
6. Toggle Dim mode; switch to Bengali; enable reduced motion to see the static versions.
