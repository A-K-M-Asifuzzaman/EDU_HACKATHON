import { expect, test } from "./fixtures";

const base = "/response/?ward=DNCC_Ward_19&origin=2024-08-05&horizon=3&nointro";
const wardOption = "Ward (priority order)";

test("the Response deep link, scope, and Dispatch use the same ward", async ({ page }) => {
  await page.goto(base);
  const engine = page.locator("#engine");
  const dispatch = page.locator("#dispatch");
  await expect(dispatch.getByTestId("sms-text")).toContainText("DNCC_Ward_19", { timeout: 30_000 });
  await expect(engine.getByLabel("Ward", { exact: true })).toHaveValue("DNCC_Ward_19");
  await dispatch.getByLabel("Brief city").selectOption("Dhaka South");
  await dispatch.getByLabel(wardOption).selectOption("DSCC_Ward_04");
  await expect(engine.getByLabel("Ward", { exact: true })).toHaveValue("DSCC_Ward_04");
  await expect(dispatch.getByTestId("sms-text")).toContainText("DSCC_Ward_04");
  await expect(page).toHaveURL(url => url.searchParams.get("ward") === "DSCC_Ward_04" && !url.searchParams.has("city"));
  await engine.getByLabel("City", { exact: true }).first().selectOption("Gazipur");
  await expect(dispatch.getByLabel(wardOption)).toHaveValue(/^GCC_Ward_/);
  await expect(dispatch.getByTestId("sms-text")).toContainText("GCC_Ward_");
  await expect(page).toHaveURL(url => url.searchParams.get("city") === "Gazipur" && url.searchParams.get("ward")!.startsWith("GCC_Ward_"));
});

test("a shared scenario restores advanced settings, Back, Forward and the demo reset", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const query = "&scenario_v=1&city=Dhaka+North&source=replay&stock=0.55&capacity_pct=120&mode=manual&assign=DNCC_Ward_19%3A1&override=DNCC_Ward_19%3A8&effect=0.45";
  await page.goto(base + query);
  const dispatch = page.locator("#dispatch");
  const id = dispatch.getByTestId("scenario-id");
  await expect(dispatch.getByTestId("sms-text")).toContainText("DNCC_Ward_19", { timeout: 30_000 });
  await expect(dispatch.getByTestId("snapshot")).toContainText("Stock 55%, 20 crews");
  await expect(dispatch.getByTestId("snapshot")).toContainText("capacity 120%, effect 45%");
  await expect(page.locator("#surge").getByLabel("Capacity for DNCC_Ward_19")).toHaveValue("8");
  await expect(page.locator("#vector").getByRole("radio", { name: "Manual", exact: true })).toBeChecked();
  const initial = await id.innerText();
  await page.getByRole("button", { name: "Copy scenario link", exact: true }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.getAll("assign")).toEqual(["DNCC_Ward_19:1"]);
  expect(new URL(link).searchParams.getAll("override")).toEqual(["DNCC_Ward_19:8"]);
  await page.goto(link);
  await expect(id).toHaveText(initial);
  const stock = page.locator("#supply").getByLabel("Regional stock", { exact: true });
  await stock.fill("70");
  await expect(page).toHaveURL(url => url.searchParams.get("stock") === "0.7");
  await expect(dispatch.getByTestId("snapshot")).toContainText("Stock 70%");
  const changed = await id.innerText();
  expect(changed).not.toBe(initial);
  await page.goBack();
  await expect(stock).toHaveValue("55");
  await expect(id).toHaveText(initial);
  await page.goForward();
  await expect(stock).toHaveValue("70");
  await expect(id).toHaveText(changed);
  await page.getByRole("button", { name: "Reset scenario", exact: true }).click();
  await expect(stock).toHaveValue("60");
  await expect(page).toHaveURL(url => !url.searchParams.has("override") && !url.searchParams.has("assign") && url.searchParams.get("stock") === "0.6");
  await expect(dispatch.getByTestId("snapshot")).toContainText("Stock 60%");
});

test("a pending scenario cannot copy or export the previous Dispatch snapshot", async ({ page }) => {
  let unblock!: () => void;
  const hold = new Promise<void>(resolve => { unblock = resolve; });
  await page.route("**/api/dispatch/brief?*", async route => {
    if (new URL(route.request().url()).searchParams.get("stock") === "0.35") await hold;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(base);
    const dispatch = page.locator("#dispatch");
    const stock = page.locator("#supply").getByLabel("Regional stock", { exact: true });
    const copy = dispatch.getByRole("button", { name: "Copy SMS" });
    const pdf = dispatch.getByRole("button", { name: "Download this ward as PDF" });
    await expect(copy).toBeEnabled({ timeout: 30_000 });
    const old = await dispatch.getByTestId("scenario-id").innerText();
    const slower = page.waitForRequest(req => req.url().includes("/api/dispatch/brief?") && new URL(req.url()).searchParams.get("stock") === "0.35");
    await stock.fill("35");
    await expect(dispatch.getByText("Previous brief · preparing the selected scenario")).toBeVisible();
    await expect(copy).toBeDisabled();
    await expect(pdf).toBeDisabled();
    await expect(dispatch.getByTestId("scenario-id")).toHaveText(old);
    await slower;
    const response = page.waitForResponse(res => res.url().includes("/api/dispatch/brief?") && new URL(res.url()).searchParams.get("stock") === "0.75" && res.ok());
    await stock.fill("75");
    const data = await (await response).json();
    expect(data.scenario.version).toBe(1);
    await expect(dispatch.getByTestId("scenario-id")).toHaveText(data.scenario.id);
    unblock();
    await expect(copy).toBeEnabled();
    await expect(pdf).toBeEnabled();
    await expect(dispatch.getByTestId("snapshot")).toContainText("Stock 75%");
  } finally {
    unblock();
  }
});
