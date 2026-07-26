import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  captureConsoleErrors,
  enterDraftRoom,
  MOCK_DRAFT_ID,
  setFixture,
} from "./helpers";

test.describe("guest auction journey", () => {
  test("configured signed-out browsing does not contact account providers", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    test.skip(
      !process.env.NEXT_PUBLIC_SUPABASE_URL,
      "Run this check with the complete public account test configuration.",
    );
    const accountProviderRequests: string[] = [];
    page.on("request", (request) => {
      if (/supabase|hcaptcha/i.test(request.url())) {
        accountProviderRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
    await page.waitForTimeout(500);

    expect(accountProviderRequests).toEqual([]);
  });

  test("connects, configures stars and scrubs, advances picks, and recovers without duplicates", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    const consoleErrors = captureConsoleErrors(page);
    const sleeperRequests: Array<{ method: string; url: string }> = [];
    const optionalAccountRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/sleeper/") ||
        request.url().includes("api.sleeper.app")
      ) {
        sleeperRequests.push({ method: request.method(), url: request.url() });
      }
      if (/supabase|hcaptcha/i.test(request.url())) {
        optionalAccountRequests.push(request.url());
      }
    });

    await enterDraftRoom(page);
    await expect(page.getByRole("button", { name: /account/i })).toHaveCount(0);
    await expect(page.getByText("Fresh")).toBeVisible();
    const selected = page.getByLabel("Selected player");
    await expect(selected.getByText("Base value")).toBeVisible();
    await expect(selected.getByText("Adjusted value")).toBeVisible();
    await expect(selected.getByText("My max bid")).toBeVisible();

    const playerRowBefore = await page
      .getByRole("button", { name: /Brock Bowers/i })
      .locator("xpath=ancestor::tr")
      .innerText();

    await setFixture(page, 1);
    await expect(selected.getByText("Trey McBride")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText("Latest purchase · $40")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team 1" }).locator("xpath=ancestor::section"),
    ).toContainText("$10");

    const playerRowAfter = await page
      .getByRole("button", { name: /Brock Bowers/i })
      .locator("xpath=ancestor::tr")
      .innerText();
    expect(playerRowAfter).not.toBe(playerRowBefore);

    await setFixture(page, 1, "offline");
    await expect(page.getByText("Stale")).toBeVisible({ timeout: 8_000 });
    await expect(selected.getByText("Trey McBride")).toBeVisible();

    await setFixture(page, 1, "online");
    await page.getByRole("button", { name: "Retry sync" }).click();
    await expect(page.getByText("Fresh")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team 1" }).locator("xpath=ancestor::section"),
    ).toContainText("$10");
    await expect(
      page.getByRole("heading", { name: "Team 1" }).locator("xpath=ancestor::section"),
    ).toContainText("Trey McBride");
    await expect(
      page.getByRole("heading", { name: "Team 1" }).locator("xpath=ancestor::section")
        .getByText("Trey McBride"),
    ).toHaveCount(1);

    await page.reload();
    await expect(page.getByText("Auction Companion")).toBeVisible();
    await expect(selected.getByText("Trey McBride")).toBeVisible();
    expect(sleeperRequests.length).toBeGreaterThan(0);
    expect(new Set(sleeperRequests.map((request) => request.method))).toEqual(
      new Set(["GET"]),
    );
    expect(optionalAccountRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await expect(page.locator("main > div")).toHaveCSS("opacity", "1");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("persists and reverses a local purchase correction", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await enterDraftRoom(page);

    await page.getByRole("button", { name: "Add local purchase correction" }).click();
    await page.getByLabel("Assign to").selectOption("1");
    await page.getByLabel("Local sale price").fill("10");
    await page.getByRole("button", { name: "Save local correction" }).click();
    const myTeam = page
      .getByRole("heading", { name: "Team 1" })
      .locator("xpath=ancestor::section");
    await expect(myTeam).toContainText("Local correction");

    await page.reload();
    await expect(myTeam).toContainText("Local correction");
    await myTeam.getByRole("button", { name: /^Reverse correction for/ }).click();
    await expect(myTeam).not.toContainText("Local correction");

    await page.reload();
    await expect(myTeam).not.toContainText("Local correction");
  });

  test("supports username discovery and rejects invalid input", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await setFixture(page);
    await page.goto("/");
    const input = page.getByLabel("Sleeper username or draft link");

    await input.fill("auction_guest");
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(
      page.getByRole("button", { name: "Review Recorded league auction" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review Recorded mock auction" }),
    ).toBeVisible();

    await input.fill("bad input!");
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(
      page.getByText("Enter a Sleeper username, draft ID, or draft link."),
    ).toBeVisible();

    await input.fill("9999999999");
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(page).toHaveURL(/\/draft\/9999999999\/setup$/);
    await expect(page.getByText(/snake draft.*auction drafts only/i)).toBeVisible();

    await page.goto("/");
    await input.fill(MOCK_DRAFT_ID);
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(page).toHaveURL(new RegExp(`/draft/${MOCK_DRAFT_ID}/setup$`));
  });

  test("labels a recorded stale projection snapshot", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await setFixture(page, 0, "stale-projections");
    await page.goto(`/draft/${MOCK_DRAFT_ID}/setup`);
    await page.getByRole("button", { name: "Set strategy" }).click();
    await page.getByRole("button", { name: "Enter draft room" }).click();
    await page.getByRole("button", { name: /^Team 1/ }).click();
    await expect(page.getByText(/Using stale projection data/)).toContainText(
      "Updated Jul 25, 2026",
    );
  });

  test("reports CSV match problems and shows projection source age", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await setFixture(page);
    await page.goto(`/draft/${MOCK_DRAFT_ID}/setup`);
    await page.getByRole("button", { name: "Set strategy" }).click();
    await page
      .locator('input[aria-label="Projection CSV"]')
      .setInputFiles({
        name: "launch-projections.csv",
        mimeType: "text/csv",
        buffer: Buffer.from([
          "player_id,name,team,position,rush_yd,rec",
          "9509,Bijan Robinson,ATL,RB,1450,72",
          ",Unknown Player,ZZZ,WR,0,10",
          ",Ronald Jones,,RB,500,20",
        ].join("\n")),
      });

    await expect(page.getByText("1 matched")).toBeVisible();
    await expect(page.getByText("1 unmatched")).toBeVisible();
    await expect(page.getByText("1 ambiguous")).toBeVisible();
    await page.getByRole("button", { name: "Enter draft room" }).click();
    await page.getByRole("button", { name: /^Team 1/ }).click();
    await page.getByRole("button", { name: "How values work" }).click();
    const dialog = page.getByRole("dialog", { name: "How values work" });
    await expect(dialog).toContainText(
      "Recorded fixture projections + CSV overrides",
    );
    await expect(dialog).toContainText("Updated Jul 25, 2026");
  });
});
