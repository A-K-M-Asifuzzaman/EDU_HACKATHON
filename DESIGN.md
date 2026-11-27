# DengueShield AI design system: "Monsoon Intelligence" in the MicroFire v2 language

Governs every page of the web app. Each rule states the token, the rule and the reason. Final version, 26 Nov 2026, after four owner
art-direction rounds: (1) stop looking AI-generated, (2) make it fancy and premium everywhere, (3) ultra-premium correction with the
Abhas site as a minimum benchmark, (4) adopt the owner's own NASA Space Apps 2026 MicroFire theme (live reference
microfire-v2-preview.vercel.app; computed styles were measured, not guessed). Skills consulted: Taste (design-taste-frontend),
UI/UX Pro Max (design-system, typography and chart lookups), Humanizer (copy only, never to flatten the visuals), ECC
frontend-design-direction and frontend-a11y (read from the local plugin cache; the plugin itself was not enabled).

## 1. Visual theme and atmosphere

Bold, graphic, confident science: electric cobalt bands, a lavender ground, heavy white-and-yellow display type, white instruments
with navy outlines and hard offset shadows, yellow pill actions. The imagery is the data itself: a rain atmosphere whose density
follows the real observed rainfall, the rain → risk instrument, a season of replayed forecasts, a skyline of 60 wards, every model
configuration on one axis, and a city-lights map of real facilities.

Signature detail: **the issue line.** Every forecast figure draws a rule at the date the forecast was issued; rain to its right had not
fallen and was never used. It encodes the project's central honesty rule and recurs across the landing, the Command Center and the Lab.

## 2. Colour palette and roles

| Token (Tailwind name) | Light | Cobalt band (`.night`) | Dim | Role and rule |
|---|---|---|---|---|
| `canvas` | #EEF1FF lavender | cobalt radial #3B3CF0 → #2A2BD6 → #1B1C9E | #0F1033 | Page ground. |
| `ivory` | #FFFFFF | #FFFFFF (cards) | #191B4D | Cards and instruments. |
| `ink` | #15153D navy | #FFFFFF | #EEF0FF | Text, outlines, hard shadows. |
| `ink-2` / `ink-3` | #3B3E6E / #53578A | #E6E8FF / #C9CCFF | #C9CCF2 / #A6AADE | Secondary text / captions (≥ 4.5:1). |
| action | #FFB020 yellow fill, navy text, navy outline | same | same | Primary actions (`a.bg-ink`, `button.bg-ink`), chapter badges, selection on cobalt. |
| `emerald` model | #2A2BD6 cobalt | #FFD166 yellow | #FFD166 | Model output (median, 80/90% bands), links, focus. |
| `sky` rain | #0B93B5 teal | #8FE3FF | #5FD0EE | Rainfall, and only rainfall. |
| `coral` outbreak | #F2475E fill, #C8243C text | #FF8A9A / #FFC0C8 | #FF6B7D / #FFC0C8 | Outbreak threshold, alerts, Emergency help (always deep red fill #C8243C). |
| `amber` observed-later | #FFB020 | #FFB020 | #FFB020 | The count observed after the issue date (diamond). |
| Risk tiers | Low #3CCB91, Medium #FFD34D, High #FF8A3D, Critical #F2475E | | | Navy text and navy outline; the word is always shown. |

Rules: white cards inside a cobalt band reset to the light tokens (`.night .card`), so instruments read the same everywhere. Colour
never carries meaning alone (words on tiers, dashed thresholds, direct labels). Contrast is checked with axe in Light and Dim.

## 3. Typography

| Role | Face | Size | Weight / tracking |
|---|---|---|---|
| Hero headline | Bricolage Grotesque Variable | 42 / 68 / 92 px (phone / tablet / desktop), line-height 0.94 | 800, -0.03em; second line in yellow |
| Page title (masthead h1) | Bricolage | 36 / 52 / 64 px | 800, -0.022em |
| Section / chapter title | Bricolage | 34-52 px | 800, -0.025em |
| Big figures | Bricolage | 30-168 px | 800, tabular |
| Panel title | Atkinson Hyperlegible Next Variable | 15 px | 600-700 |
| Body | Atkinson Hyperlegible Next | 15-17 px, line-height 1.6 | 400 |
| Captions, axes | Atkinson | 12-12.5 px | 400 |
| Bengali | Noto Sans Bengali fallback for both | | |

Atkinson Hyperlegible was designed for low-vision readers (distinct letterforms, slashed zero): the right body face for a public-health
tool, and the face the MicroFire reference uses. No uppercase slogans; no italic (Bricolage has none).

## 4. Components

- **Buttons.** Primary: yellow pill, 3 px navy outline, 3 px hard navy shadow, Bricolage 800; hover lifts 1 px, press settles into the
  shadow. Secondary (`.btn-ghost`): white pill, same outline and shadow. Danger: deep red pill. One label per intent on a page.
- **Cards** (`.card`): white, 2.5 px navy outline, 14 px radius, 4 px hard navy shadow (5 px on cobalt). Hover on linked cards lifts 2 px.
- **Segmented controls and tabs:** pill groups with a navy outline; the selected option is cobalt with white text (yellow-on-white
  inside cobalt bands is reversed automatically).
- **Status tags** (ProvChip): small tinted pills with a navy outline. **Risk badges:** tier colour, navy outline, navy text.
- **Statistics** (Kpi): white card with a 5 px tone strip on top and a Bricolage figure.
- **Chapter badges:** yellow circle, navy outline and shadow, two-digit number.
- **Charts:** direct labels; gridlines in the line colour; the issue line; 80% and 90% bands with the median as a line; observed counts as
  ink dots (hollow after the issue date); the outbreak threshold as a dashed red rule with its value written on it. Every chart has a
  text alternative or a table.

## 5. Layout

12-column grid, max width 1320 px (1440 px in tools), 16 px gutters on phones and 24-32 px above. Asymmetric splits (4/8, 5/7).
Each page: cobalt masthead band (full-bleed) with the title, then its working surface on lavender, composed for its job: decision
cockpit (Command), workbench (Lab), research comparison (Evidence), map workstation (Geography), worklist (Response).

## 6. Depth

Hard offset shadows in navy only (no blur shadows); cobalt bands carry a radial light. Overlays (menus, dialogs, toasts) use the same
hard shadow token.

## 7. Motion

Motion explains: data draws itself in (median line, rising bands and bars, rain falling into the issue line, candles rising), sections
reveal once on entry (IntersectionObserver, never scroll listeners; content stays visible without JavaScript), the ward wire drifts
and pauses on hover or focus, buttons press into their shadow. The rain atmosphere runs at about 30 fps, pauses off-screen.
`prefers-reduced-motion`: everything static and final.

## 8. Boot sequence

A procedural *Aedes aegypti* (white lyre on the thorax, banded abdomen, white tarsal bands, raised hind legs, veined iridescent wings)
flies through monsoon rain on cobalt, curious about the pointer and dodging close. Click, tap, Enter or Space swats it: ripples like a
raindrop, a short shake, and the page opens from the impact point into the cobalt hero. Skip, Emergency help and a muted-by-default
sound control are always visible; once per session; skipped under reduced motion; SVG fallback without WebGL or on low-end devices;
the page loads underneath and the intro never hides a slow backend.

## 9. States

Skeletons match the final layout. Status lines state the real request state (loading, taking longer, retrying with attempt number).
Failures name what failed, the real reason, "Try again" and somewhere useful to go. User-started actions (routing, nearest search)
show elapsed time, a slow notice and Cancel. No spinner-only states, no percentages, no invented success.

## 10. Accessibility

WCAG 2.2 AA: 4.5:1 text; visible 2 px focus; keyboard access to every control including chart weeks and forecast candles; scrollable
regions are focusable; `role=status` / `role=alert`; touch targets at least 44 px; axe serious/critical: zero across 12 routes at 390
and 1440 px in Light and Dim.

## 11. Copy

Plain and specific (Humanizer): no slogans, no "not X but Y", no dashes in copy, hyphenated ranges ("8-18 cases"), sentence case.
Every scientific limitation stays visible: synthetic data, replay not live surveillance, not medical advice, 2025 sealed, peaks
under-predicted.

## 12. Don'ts

No fake data or fake previews; no placing synthetic wards on real maps; no colour as the only signal; no decorative glows without a light
source; no blur shadows; no em dashes in copy; no second marquee on a page.
