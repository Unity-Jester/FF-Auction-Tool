import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { captureConsoleErrors, enterDraftRoom } from "./helpers";

test("keeps the draft room usable at every launch viewport", async ({
  page,
}, testInfo) => {
  const consoleErrors = captureConsoleErrors(page);
  await enterDraftRoom(page);
  const width = testInfo.project.use.viewport?.width;

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - window.innerWidth,
    document: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.document).toBeLessThanOrEqual(0);

  if (width === 390) {
    const tabs = page.getByRole("tablist", { name: "Draft room sections" });
    await expect(tabs).toBeVisible();
    for (const [tab, panel] of [
      ["Now", "draft-panel-now"],
      ["Players", "draft-panel-players"],
      ["My team", "draft-panel-team"],
      ["League", "draft-panel-league"],
    ] as const) {
      await tabs.getByRole("tab", { name: tab }).click();
      await expect(page.locator(`#${panel}`)).toBeVisible();
      const panelOverflow = await page.locator(`#${panel}`).evaluate(
        (element) =>
          element.getBoundingClientRect().right -
          document.documentElement.clientWidth,
      );
      expect(panelOverflow).toBeLessThanOrEqual(0.5);
    }
    await tabs.getByRole("tab", { name: "League" }).press("Home");
    await expect(tabs.getByRole("tab", { name: "Now" })).toBeFocused();
  } else {
    await expect(page.locator("#draft-panel-now")).toBeVisible();
    await expect(page.locator("#draft-panel-players")).toBeVisible();
    await expect(page.locator("#draft-panel-team")).toBeVisible();
    await expect(page.locator("#draft-panel-league")).toBeVisible();
    if (width === 1440) {
      const boxes = await Promise.all(
        ["players", "team", "league"].map((region) =>
          page.locator(`#draft-panel-${region}`).boundingBox(),
        ),
      );
      expect(boxes.every(Boolean)).toBe(true);
      expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    }
  }

  await expect(page.locator("main > div")).toHaveCSS("opacity", "1");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
