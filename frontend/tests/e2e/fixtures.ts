// Shared Playwright fixture: browser tests never contact MapTiler. When the dashboard is built with a MapTiler key (a real one locally,
// a placeholder in CI), place search gets no results, its style request gets a small local style with one raster basemap source, and its tiles get a 1x1 PNG. A test
// can still make tiles fail with its own page.route(...), which Playwright runs before this one (later routes take precedence).
import { expect, test as base, type Page } from "@playwright/test";

const STYLE = {
  version: 8,
  sources: { basemap: { type: "raster", tiles: ["https://api.maptiler.com/tiles/e2e/{z}/{x}/{y}.png"], tileSize: 256 } },
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef3f1" } }, { id: "basemap", type: "raster", source: "basemap" }],
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/api\.maptiler\.com\/maps\/[^/]+\/style\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(STYLE) }));
    await page.route(/api\.maptiler\.com\/tiles\//, (r) => r.fulfill({ contentType: "image/png", body: PNG }));
    await page.route(/api\.maptiler\.com\/geocoding\//, (r) => r.fulfill({ contentType: "application/json", body: '{"type":"FeatureCollection","features":[]}' }));
    await use(page);
  },
});
export { expect, type Page };
