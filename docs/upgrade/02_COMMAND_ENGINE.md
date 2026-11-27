# Phase 2 — Operations Command Engine

Starting commit `2d02af1`. The baseline already included the sticky engine rail, mobile navigation and scenario sheet, mathematical detail, animated supply distribution and transfer flows, independent OSM map, and contextual vector-control comparisons. The upgrade extends that workspace.

## Changes

- Added a Review node to Forecast → Demand → Allocation → Surge → Intervention → Dispatch → Review. The existing browser-local alert queue now filters to the shared planning city and reports the number reviewed in the rail. Pending snapshots disable review changes and log export. The queue still represents local drafts.
- Added a selected-ward readout for projected cases, allocated versus required saline, and unresolved bed demand. Values come from the matching Dispatch API brief. Pending or failed responses have explicit status instead of old figures.
- The rail surfaces individual stage failures while keeping available results visible. The full failure panel and its existing retry action provide the recovery path.
- Added keyboard-operable presentation and fullscreen controls. Presentation collapses the scenario-control panel while leaving stage navigation, the ward summary, and live results available. The browser fullscreen API supplies fullscreen mode and reports unavailability where unsupported. New text has English and Bangla strings.
- Kept the desktop-only Scenario button out of the mobile rail. The engine anchor now accounts for the sticky header. Existing API-driven motion and reduced-motion styles still apply.

## Verification

- Final browser suite passed 43 checks with retries disabled in 1.1 minutes. Coverage includes keyboard presentation, native fullscreen and exit, scoped review and reload, held scenarios, failure isolation with a local 503, recovery, routing, exports, and light/dim accessibility regression.
- Chromium viewport checks at 360, 390, 768, 1024, and 1440 px had zero document overflow in normal and presentation mode. An axe WCAG 2 A/AA scan of the review queue at 1440 px reported zero serious or critical violations. Local evidence is under the ignored `killswitch/p02/` directory.
- TypeScript and the 19-page Next static export build passed. The macOS network-isolated run verified the browser workflow and 21 of 21 identical API and export results. All 21 local artifacts were present, and the server recorded zero refused optional calls.
- Single-sample loopback timings in the isolated check included 29.7 ms for 30% allocation, 23.1 ms for 120% overflow, 130.8 ms for the default intervention, and 50.9 ms for one ward PDF. These are runtime observations without percentile claims.

No algorithm, infrastructure, authentication policy, or delivery integration changed. City-scope filtering uses the existing forecast endpoint. The public queue remains browser-local and stores no approval records. Persistent officer decisions, operational persistence, and alternative solvers are subsequent work.
