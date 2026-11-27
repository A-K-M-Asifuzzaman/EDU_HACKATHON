// Optional mosquito cursor and flight sound: off by default, never intercepts clicks, rests (no animation) when the pointer stops.
import { expect, test } from "./fixtures";

test.use({ reducedMotion: "no-preference" });

test("the mosquito cursor is opt-in, ignores the pointer and rests when the mouse stops", async ({ page }) => {
  await page.goto("/?nointro");
  await expect(page.locator(".ds-mosquito")).toHaveCount(0);
  const btn = page.getByRole("button", { name: /Mosquito cursor: off/ });
  await btn.click();
  await expect(page.getByRole("button", { name: /Mosquito cursor: on/ })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(200, 200); await page.mouse.move(420, 300, { steps: 8 });
  const m = page.locator(".ds-mosquito");
  await expect(m).toHaveCount(1);
  expect(await m.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  await page.waitForTimeout(800);
  await expect(m).toHaveAttribute("data-moving", "");                      // at rest: wings stop, no frame loop
  await expect(page.getByRole("button", { name: /Flight sound: off/ })).toBeVisible();   // sound stays off until asked
});
