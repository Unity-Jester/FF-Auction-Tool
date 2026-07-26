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
    await expect(selected.getByText("Recommended max")).toBeVisible();
    await expect(selected.getByText("Best fits now")).toBeVisible();
    await expect(selected.getByText(/Strategy ceiling.*Hard legal max/i)).toBeVisible();

    const playerRowBefore = await page
      .getByRole("button", { name: /Bijan Robinson/i })
      .locator("xpath=ancestor::tr")
      .innerText();
    expect(playerRowBefore).toBe(
      "Bijan Robinson\nATL · RB\n\t322.9\t$40\t$46\t$46",
    );
    await page.getByRole("button", { name: /Bijan Robinson/i }).click();
    await expect(selected).toContainText(
      "Base value$40Adjusted value$46Recommended max$46",
    );
    await expect(selected).toContainText(
      "Strategy ceiling $47 · Hard legal max $47",
    );
    await expect(selected).toContainText(
      "League inflation 1.00× · RB inflation 1.00×",
    );

    await setFixture(page, 1);
    await expect(selected.getByRole("heading", { name: "Bijan Robinson" })).toBeVisible({
      timeout: 8_000,
    });
    await expect(selected).toContainText(
      "Base value$33Adjusted value$38Recommended max$8",
    );
    await expect(selected).toContainText("Strategy ceiling $8 · Hard legal max $8");
    await expect(selected).toContainText(
      "Bijan Robinson · RB need · Elite tier · 1 remain · max $8",
    );
    await expect(selected).toContainText(
      "League inflation 0.80× · RB inflation 0.82×",
    );
    await expect(page.getByText("Latest purchase · $40")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team 1" }).locator("xpath=ancestor::section"),
    ).toContainText("$10");

    const playerRowAfter = await page
      .getByRole("button", { name: /Bijan Robinson/i })
      .locator("xpath=ancestor::tr")
      .innerText();
    expect(playerRowAfter).toBe(
      "Bijan Robinson\nATL · RB\n\t322.9\t$33\t$38\t$8",
    );
    expect(playerRowAfter).not.toBe(playerRowBefore);

    await setFixture(page, 1, "offline");
    await expect(page.getByText("Stale")).toBeVisible({ timeout: 8_000 });
    await expect(selected.getByRole("heading", { name: "Bijan Robinson" })).toBeVisible();

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
    await expect(selected.getByRole("heading", { name: "Bijan Robinson" })).toBeVisible();
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

  test("loads the completed fixture with exact final balances and no duplicate players", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await enterDraftRoom(page);
    await setFixture(page, 16);
    await page.reload();

    await expect(page.getByText("Draft complete", { exact: true })).toBeVisible();
    const summary = page.getByRole("heading", {
      name: "Final rosters and balances",
    }).locator("xpath=ancestor::section");
    await expect(summary).toContainText("Team 1$7 · 4 players");
    await expect(summary).toContainText("Team 2$6 · 4 players");
    await expect(summary).toContainText("Team 3$16 · 4 players");
    await expect(summary).toContainText("Team 4$13 · 4 players");

    const teamOne = page
      .getByText("Team 1 · You", { exact: true })
      .locator("xpath=ancestor::details");
    await expect(teamOne).toContainText("$7 · max $0");
    for (const playerName of [
      "Trey McBride",
      "Jalen Hurts",
      "Justin Jefferson",
      "Josh Jacobs",
    ]) {
      await expect(teamOne.getByText(new RegExp(playerName))).toHaveCount(1);
    }
    await expect(page.getByRole("button", { name: /^Edit league purchase/ })).toHaveCount(0);
  });

  test("keeps the live room readable in the system light theme", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await page.emulateMedia({ colorScheme: "light" });
    await enterDraftRoom(page);

    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(247, 248, 244)",
    );
    await expect(page.locator("body")).toHaveCSS(
      "color",
      "rgb(24, 32, 23)",
    );
    await expect(page.locator("main > div")).toHaveCSS("opacity", "1");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("carries corrected scoring, flex slots, stable player calls, and projection overrides into live guidance", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await setFixture(page);
    await page.goto(`/draft/${MOCK_DRAFT_ID}/setup`);

    await expect(
      page.getByText(/Sleeper provided only a scoring type/i),
    ).toBeVisible();
    await page.getByLabel("Reception points").fill("0.5");
    await expect(
      page.getByLabel("Reception points").locator("xpath=.."),
    ).toContainText("Local edit");
    await page.getByRole("button", { name: "Add flex group" }).click();
    await page.getByLabel("Flex 1 slots").fill("1");
    await page.getByLabel("Flex 1 eligibility").fill("RB,WR,TE");
    await expect(page.getByText(/3 fixed starters.*1 flex.*1 bench.*5 total/i)).toBeVisible();
    await page.getByRole("button", { name: "Set strategy" }).click();

    const player = page.getByRole("combobox", { name: "Player" });
    await player.fill("Bijan Robinson");
    await page
      .getByRole("option", { name: /Bijan Robinson.*ATL.*RB.*9509/ })
      .click();
    await page.getByRole("button", { name: "Target player" }).click();
    await page.getByLabel("Manual value").fill("47");
    await page.getByRole("button", { name: "Set manual value" }).click();
    await page.getByLabel("Projection statistic").selectOption("rushYards");
    await page.getByLabel("Projection stat value").fill("1600");
    await page.getByRole("button", { name: "Set projection stat" }).click();
    await expect(
      page.locator("p").filter({ hasText: /Bijan Robinson.*Target/i }),
    ).toBeVisible();
    await expect(
      page.locator("p").filter({
        hasText: /Bijan Robinson.*Manual dollar value.*\$47/i,
      }),
    ).toBeVisible();
    await expect(
      page.locator("p").filter({
        hasText: /Bijan Robinson.*Individual projection.*Rush yards 1,600/i,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Enter draft room" }).click();
    await page.getByRole("button", { name: /^Team 1/ }).click();
    await page.getByRole("button", { name: /Bijan Robinson/i }).click();
    const selected = page.getByLabel("Selected player");
    await expect(selected).toContainText("target");
    await expect(selected.getByText(/Fixed: QB 1 · RB 1 · WR 1/i)).toBeVisible();
    await expect(selected.getByText(/Flex: 1 RB\/WR\/TE/i)).toBeVisible();
    await expect(selected.getByText(/Bench: 1/i)).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /Bijan Robinson/i }).click();
    await expect(page.getByLabel("Selected player")).toContainText("target");
  });

  test("requires explicit confirmation for unknown scoring before strategy setup", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440");
    await setFixture(page, 0, "unknown-scoring");
    await page.goto(`/draft/${MOCK_DRAFT_ID}/setup`);

    await expect(
      page.getByText("Sleeper did not provide usable scoring rules."),
    ).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Set strategy" });
    await expect(continueButton).toBeDisabled();
    await page.getByLabel("I verified the scoring rules").check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(page).toHaveURL(
      new RegExp(`/draft/${MOCK_DRAFT_ID}/strategy$`),
    );
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
    await page
      .getByRole("button", { name: "Review Recorded league auction" })
      .click();
    await expect(page).toHaveURL(/\/draft\/9876543210\/setup$/);
    await page.getByRole("button", { name: "Set strategy" }).click();
    await page.getByRole("button", { name: "Enter draft room" }).click();
    await page.getByRole("button", { name: /^Team 1/ }).click();
    await expect(page).toHaveURL(/\/draft\/9876543210$/);
    await expect(page.getByText("Auction Companion")).toBeVisible();

    await page.goto("/");
    const homeInput = page.getByLabel("Sleeper username or draft link");
    await homeInput.fill("bad input!");
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(
      page.getByText("Enter a Sleeper username, draft ID, or draft link."),
    ).toBeVisible();

    await homeInput.fill("9999999999");
    await page.getByRole("button", { name: "Connect draft" }).click();
    await expect(page).toHaveURL(/\/draft\/9999999999\/setup$/);
    await expect(page.getByText(/snake draft.*auction drafts only/i)).toBeVisible();

    await page.goto("/");
    await page
      .getByLabel("Sleeper username or draft link")
      .fill(MOCK_DRAFT_ID);
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
