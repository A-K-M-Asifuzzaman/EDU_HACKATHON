import { expect, test } from "./fixtures";

test("the optional allocation comparison uses the shared city and keeps Dispatch unchanged", async ({ page }) => {
  await page.goto("/response/?ward=GCC_Ward_04&city=Gazipur&origin=2024-08-05&horizon=3&nointro");
  const scenario = page.locator("#dispatch").getByTestId("scenario-id");
  await expect(scenario).toHaveText(/^S-/, { timeout: 25_000 });
  const id = await scenario.innerText();
  const section = page.locator("#supply");
  await section.getByText("Historical demand stress test", { exact: true }).click();
  await section.getByLabel("Emergency reserve (%)").fill("10");
  await section.getByLabel("Exact stock for this city").fill("40");
  await section.getByRole("button", { name: "Run comparison" }).click();
  await expect(section.getByText("Gazipur · 4 reserved · 36 assignable")).toBeVisible();
  await expect(section.getByText("25 prior-season weeks")).toBeVisible();
  await expect(section.getByText("Tail-risk plan", { exact: true })).toBeVisible();
  await expect(section.getByText("Current hybrid", { exact: true })).toBeVisible();
  await expect(scenario).toHaveText(id);
  await section.getByLabel("Emergency reserve (%)").fill("20");
  await expect(section.getByText("Settings changed. Run a new comparison.")).toBeVisible();
  await expect(section.getByText("Tail-risk plan", { exact: true })).toHaveCount(0);
  await expect(scenario).toHaveText(id);
});
