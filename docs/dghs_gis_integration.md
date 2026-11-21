# DGHS Bangladesh GIS integration (official ward boundaries)

Layer: `https://gis.dghs.gov.bd/server/rest/services/Hosted/All_Wards_main/FeatureServer/0`
Code: `dengueshield/api/geo.py`, endpoints `/api/geo/dghs/{status,filters,wards}`, page `frontend/app/geography/`.

## 1. What was verified, and what was not (tested 21 Nov 2026)

| Question | Result |
|---|---|
| Does the host resolve? | Yes: `gis.dghs.gov.bd` → 103.247.238.33. `dghs.gov.bd` itself answered HTTP 200 in 0.3 s. |
| Can the layer be queried? | **Not verified.** From the development machine, TCP connections to ports 443 and 80 timed out (also after 3 retries, 25 s each). From a second, independent network (the web-fetch tool) the connection was refused (`ECONNREFUSED 103.247.238.33:443`). The service may be down, firewalled, or restricted to Bangladeshi networks. |
| Layer metadata (fields, geometry type, `maxRecordCount`, GeoJSON support, pagination) | **Not read.** Nothing about the schema was assumed from memory. |
| Data coverage (which districts, cities, how many wards) | **Unknown.** Not measured. |
| Reuse permission / licence | **Not verified.** No licence or terms text could be read. The app therefore fetches boundaries at runtime, caches them locally (`.cache/geo`, git-ignored), does not commit or redistribute them, and says "reuse terms not verified" in the UI and API. Confirm terms with DGHS before any public deployment. |
| Protocol handling (pagination, filters, caching, outage behaviour) | **Verified against a mock ArcGIS server** with invented attributes (`tests/test_geo.py`, 13 tests; two Playwright tests). The mock proves our code follows the ArcGIS REST query protocol, not that DGHS behaves the same. |

Please verify from a network that can reach it, then check the "Geography" page:

```bash
L=https://gis.dghs.gov.bd/server/rest/services/Hosted/All_Wards_main/FeatureServer/0
curl -s "$L?f=pjson" | python3 -m json.tool | head -80                      # fields, maxRecordCount, formats, copyrightText, licenseInfo
curl -s "$L/query?where=1%3D1&returnCountOnly=true&f=json"                  # total features
curl -s "$L/query?where=1%3D1&outFields=*&resultRecordCount=2&returnGeometry=false&f=json"
curl -s localhost:8000/api/geo/dghs/status | python3 -m json.tool           # what the app detected
```

## 2. Design

- **Field discovery, not assumption.** District, city and ward filter fields are detected from the layer's own field names/aliases
  (`ROLE_PATTERNS` in `geo.py`). A role with no matching field is reported as "none" and filtering on it returns a clear 422; it is never
  guessed. Override with `DGHS_FIELD_DISTRICT`, `DGHS_FIELD_CITY`, `DGHS_FIELD_WARD` (process environment variables, e.g. `DGHS_FIELD_WARD=ward_no ./scripts/launch.sh`; the `.env` loader does not read them) after inspecting the metadata.
- **Pagination.** `resultOffset`/`resultRecordCount` ≤ the server's `maxRecordCount` (cap 1,000), ordered by the object-ID field for stable pages,
  `f=geojson`, `outSR=4326`, coordinate precision 5, optional `maxAllowableOffset` simplification (default ≈ 20 m). Stops on `exceededTransferLimit`
  or a short page. A hard cap of 3,000 features per response sets `truncated: true` when hit.
- **Filters are injection-safe.** Values are validated (length, control characters, integers for numeric fields) and quoted with `'` doubled.
- **Caching and failure handling.** Memory + disk cache (metadata and distinct values 24 h, GeoJSON 7 days); a stale copy is served and labelled if the
  service is down. Connect timeout 6 s, read timeout 30 s; after a network failure a 60 s circuit breaker makes further calls fail in milliseconds
  (measured: first failure 6.1 s, then 3 ms). ArcGIS errors returned as HTTP 200 `{"error": …}` are treated as errors. When nothing is cached, endpoints return
  503 `{"status": "unavailable"}`; the page shows a notice and every other page is unaffected.
- **Attribution.** Every response and the page show the DGHS attribution; the map shows "Boundaries © DGHS Bangladesh" next to the MapTiler/OSM credits.
- **MapLibre + MapTiler.** `frontend/components/dghsmap.tsx` uses the existing `NEXT_PUBLIC_MAPTILER_KEY` basemap; without a key (or on a 401/403) it falls back
  to a blank basemap so the boundaries still render. Polygons use one neutral colour; click shows the DGHS attributes.

## 3. No ward matching, by design

The competition's ward IDs (`DNCC_Ward_19`, …) are synthetic. No published crosswalk to official ward codes exists, and name/number matching would be a
guess, so:

- official polygons carry **no** forecast, risk tier, or dataset ward ID (the API returns the DGHS properties unchanged; a test asserts this);
- predictions are displayed in the **abstract ward-risk matrix** (same component as the Ward Risk Explorer), which has no spatial meaning;
- every response includes `id_mapping: {status: "unmapped", verified: false, reason: …}`.

If DGHS or the organizers ever publish a crosswalk, the join should be implemented as an explicit, versioned file validated against the live layer
(all keys present and unique), and the UI should state its source. Until then the mapping stays "unmapped".

## 4. Cost and limits

No API key is needed for the public layer. Typical use is one metadata request per day, one query per distinct filter per week, and a few KB of
distinct-value lookups; nothing is queried until the Geography page is opened.
